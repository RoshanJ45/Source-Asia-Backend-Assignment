# Combined Project Documentation

This document combines documentation for two Node.js backend projects:

1. Rate Limiter API
2. Product Catalog API

---

# Rate Limiter API

A zero-dependency Node.js HTTP server that enforces per-user request rate limits
using an **in-memory sliding window** algorithm.

---

## Quick start

```bash
# Clone / unzip the project, then:
node index.js          # defaults to PORT 3000
PORT=8080 node index.js  # custom port
```

Requirements: **Node.js ≥ 16** (uses built-in `http` — no npm install needed).

---

## Running the tests

```bash
node test.js
```

The test suite spins up the server on a random free port, runs 6 test groups
(24 assertions), and exits with code 0 on success or 1 on failure.

---

## API reference

### `POST /request`

Submit a request on behalf of a user. Counts toward the user's rate-limit quota.

**Request body** (JSON):

```json
{ "user_id": "alice" }
```

| Field     | Type   | Rules                                                            |
|-----------|--------|------------------------------------------------------------------|
| `user_id` | string | Required. Non-empty. Letters, digits, `-`, `_`, `.` only.       |

#### 200 OK — accepted

```json
{
  "status": "accepted",
  "user_id": "alice",
  "accepted_in_window": 3,
  "rejected_cumulative": 0,
  "window_seconds": 60,
  "limit": 5
}
```

#### 429 Too Many Requests — rate limit exceeded

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Maximum 5 requests per 60s window.",
  "user_id": "alice",
  "accepted_in_window": 5,
  "rejected_cumulative": 2,
  "window_seconds": 60,
  "limit": 5
}
```

#### 400 Bad Request — invalid input

```json
{
  "error": "Bad Request",
  "message": "user_id must not be empty or whitespace"
}
```

---

### `GET /stats/:userId`

Read the current counters for a user **without** consuming a quota slot.

#### 200 OK

```json
{
  "user_id": "alice",
  "accepted_in_window": 3,
  "rejected_cumulative": 2,
  "window_seconds": 60,
  "limit": 5
}
```

#### 404 Not Found

Returned when no requests have ever been made for that `user_id`.

---

### `GET /health`

Returns `{ "status": "ok" }` with HTTP 200. Useful for load-balancer probes.

---

## Response schema (full)

| Field                 | Type    | Present in          | Meaning                                                                 |
|-----------------------|---------|---------------------|-------------------------------------------------------------------------|
| `status`              | string  | 200 /request only   | `"accepted"`                                                            |
| `error`               | string  | 4xx responses       | Short error label                                                       |
| `message`             | string  | 4xx responses       | Human-readable explanation                                              |
| `user_id`             | string  | all non-error       | Echoed back                                                             |
| `accepted_in_window`  | integer | all non-error       | Accepted requests in the **current** sliding window (resets naturally)  |
| `rejected_cumulative` | integer | all non-error       | Total rejected across **all** windows since server start (never resets) |
| `window_seconds`      | integer | all non-error       | Window size (60)                                                        |
| `limit`               | integer | all non-error       | Max accepted per window (5)                                             |

---

## Rate-limiting design decisions

### Algorithm: Sliding Window Log

Each `user_id` keeps a log of epoch-millisecond timestamps for every accepted
request.  On each incoming call:

1. **Evict** timestamps older than `now − 60 000 ms`.
2. If `log.length < 5` → **accept**, push timestamp.
3. Otherwise → **reject** with HTTP 429.

This is a true sliding window (not fixed/tumbling), so a user cannot burst at
the boundary of two windows.

### Why not a fixed window?

A fixed window resets at a hard clock boundary (e.g. every :00 second).  A user
could make 5 requests at :59 and 5 more at :01 — 10 in two seconds — and both
batches would be accepted.  The sliding window prevents that.

### Counters

| Counter               | Scope       | Resets?                              |
|-----------------------|-------------|--------------------------------------|
| `accepted_in_window`  | Per window  | Naturally, as old timestamps expire  |
| `rejected_cumulative` | Cumulative  | Never (only reset by server restart) |

`rejected_cumulative` is intentionally cumulative so operators can see total
abuse volume across many windows without having to track per-window rejects.

### HTTP status for over-limit: 429

RFC 6585 defines 429 *Too Many Requests* for exactly this purpose. A 503
*Service Unavailable* would incorrectly imply a server-side fault. 

### Concurrency safety

Node.js is single-threaded: the event loop processes exactly one callback at a
time.  The check-and-update step in `rateLimiter.js` is **fully synchronous**
(no `await` between the read and the write), so it runs atomically within one
event-loop tick.  Parallel HTTP requests are queued and handled one at a time,
guaranteeing that the accepted count never exceeds 5 per window even under high
concurrency.

---

## curl examples

```bash
BASE=http://localhost:3000

# 1. Accept 5 requests for "alice"
for i in 1 2 3 4 5; do
  curl -s -X POST $BASE/request \
       -H 'Content-Type: application/json' \
       -d '{"user_id":"alice"}' | jq .
done

# 2. 6th request → 429
curl -s -X POST $BASE/request \
     -H 'Content-Type: application/json' \
     -d '{"user_id":"alice"}' | jq .

# 3. Different user is unaffected
curl -s -X POST $BASE/request \
     -H 'Content-Type: application/json' \
     -d '{"user_id":"bob"}' | jq .

# 4. Check stats (does NOT consume quota)
curl -s $BASE/stats/alice | jq .

# 5. Missing user_id → 400
curl -s -X POST $BASE/request \
     -H 'Content-Type: application/json' \
     -d '{}' | jq .

# 6. Invalid JSON → 400
curl -s -X POST $BASE/request \
     -H 'Content-Type: application/json' \
     -d 'not-json' | jq .

# 7. Simulate concurrent burst (10 in parallel — expect exactly 5 accepted)
for i in $(seq 1 10); do
  curl -s -X POST $BASE/request \
       -H 'Content-Type: application/json' \
       -d '{"user_id":"concurrent-test"}' &
done
wait
```

---

## Production limitations

This implementation is intentionally minimal (Part 1 requirements). Before
using it in production, be aware of:

| Limitation | Impact | Production remedy |
|---|---|---|
| **Single process** | One Node.js process handles all traffic; no horizontal scaling. | Use a cluster or process manager (PM2, systemd). |
| **In-memory store** | State is lost on restart. All counters reset to zero. | Use Redis (e.g. `SET`/`INCR` with `EXPIRE`) as a shared, persistent store. |
| **No persistence** | A crash wipes all rate-limit history. Users can bypass limits by triggering a restart. | Redis or a durable KV store. |
| **Multi-instance / multi-host** | If two instances run simultaneously, each has its own store. A user can send 5 requests to instance A and 5 to instance B — 10 total accepted. | Centralised store (Redis) with atomic Lua scripts or `INCR`+`EXPIRE`. |
| **Memory growth** | `store` Map grows with every distinct `user_id` seen and is never pruned. Under sustained diverse traffic this is a memory leak. | Periodic eviction (LRU cache), TTL-based expiry, or Redis with `EXPIRE`. |
| **No TLS** | Traffic is plain HTTP. | Terminate TLS at a load balancer or use `https.createServer`. |
| **No authentication** | Any caller can spoof any `user_id`. | Authenticate the `user_id` via JWT, API key, or session. |
| **Clock skew** | `Date.now()` on a single instance is consistent, but in a distributed system clocks can differ. | Use a time-synchronised source (NTP) or Redis `TIME` command. |
| **No rate-limit headers** | RFC 6585 recommends `Retry-After`, `X-RateLimit-*` headers for client guidance. | Add `Retry-After: <seconds>` and `X-RateLimit-Remaining` to responses. |



ewpage

---

# Product Catalog API

A RESTful API for managing products with image and video URL media, built with Node.js + Express and in-memory storage.

---

## Quick Start

```bash
npm install
npm start          # starts on http://localhost:3000
```

Optional: seed 1,000 products for performance testing (requires the server to be running):

```bash
node src/seed.js
```

Run automated tests (requires the server to be running):

```bash
node tests/api.test.js
```

---

## Endpoints

All endpoints accept and return `application/json`.

### `POST /products`

Create a new product.

**Request body:**

```json
{
  "name": "Widget A",
  "sku": "SKU-001",
  "image_urls": ["https://cdn.example.com/products/sku-001/img-1.jpg"],
  "video_urls": ["https://cdn.example.com/products/sku-001/demo.mp4"]
}
```

| Field        | Type             | Required | Notes                          |
|--------------|------------------|----------|--------------------------------|
| `name`       | string           | ✅        | non-empty after trim           |
| `sku`        | string           | ✅        | non-empty after trim, unique   |
| `image_urls` | array of strings | optional | see URL rules below            |
| `video_urls` | array of strings | optional | see URL rules below            |

**Responses:**

| Status | Meaning                            |
|--------|------------------------------------|
| `201`  | Created — returns full product     |
| `400`  | Validation error — see `details`   |
| `409`  | Duplicate SKU                      |

---

### `GET /products`

List products for a UI grid. **Fast** — never returns `image_urls` or `video_urls` arrays.

**Query parameters:**

| Param       | Default | Max  | Notes                          |
|-------------|---------|------|--------------------------------|
| `limit`     | 20      | 100  | items per page                 |
| `offset`    | 0       | —    | skip N items                   |
| `page`      | —       | —    | alternative to offset          |
| `page_size` | —       | —    | alias for limit                |

**Response:**

```json
{
  "total": 1000,
  "limit": 20,
  "offset": 0,
  "items": [
    {
      "id": "uuid",
      "name": "Widget A",
      "sku": "SKU-001",
      "image_count": 2,
      "video_count": 1,
      "thumbnail_url": "https://cdn.example.com/...",
      "created_at": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

> `image_urls` and `video_urls` are intentionally **omitted** from this response (see Performance section).

---

### `GET /products/:id`

Detail page. Returns the full product including all URL arrays.

**Response:**

```json
{
  "id": "uuid",
  "name": "Widget A",
  "sku": "SKU-001",
  "image_count": 2,
  "video_count": 1,
  "thumbnail_url": "https://cdn.example.com/img1.jpg",
  "created_at": "2025-01-01T00:00:00.000Z",
  "image_urls": ["https://...", "https://..."],
  "video_urls": ["https://..."]
}
```

| Status | Meaning       |
|--------|---------------|
| `200`  | OK            |
| `404`  | Product not found |

---

### `POST /products/:id/media`

Append new image/video URLs to an existing product.

**Request body:**

```json
{
  "image_urls": ["https://cdn.example.com/new-img.jpg"],
  "video_urls": ["https://cdn.example.com/new-vid.mp4"]
}
```

At least one of `image_urls` or `video_urls` must be provided and non-empty.

**Responses:**

| Status | Meaning                          |
|--------|----------------------------------|
| `200`  | OK — returns updated full product |
| `400`  | Validation error                 |
| `404`  | Product not found                |

---

## Validation Rules

- `name` — required, non-empty string (whitespace-only rejected)
- `sku` — required, non-empty string, must be unique across all products
- **URL format** — must start with `http://` or `https://`
- **URL max length** — 2048 characters
- **URLs per array per request** — maximum **20**
- Duplicate `sku` on create → `409 Conflict`

---

## Data Model & Performance

### In-Memory Structure

Two separate maps are maintained:

```
productsMap { [id]: { id, name, sku, image_count, video_count, thumbnail_url, created_at } }
mediaMap    { [id]: { image_urls: [...], video_urls: [...] } }
skuIndex    { [sku]: id }
insertionOrder [ id, id, ... ]
```

**Why two maps?**

`GET /products?limit=20` reads only from `productsMap` — it never touches `mediaMap`.
With 1,000 products each having 10 images, the list endpoint skips all 10,000 image URLs.
Only `GET /products/:id` (detail page) merges both maps.

### How List vs Detail Queries Differ

| Endpoint              | Reads from          | Cost           |
|-----------------------|---------------------|----------------|
| `GET /products`       | `productsMap` only  | O(limit)       |
| `GET /products/:id`   | both maps           | O(1) each      |
| `POST /products/:id/media` | mutates `mediaMap` | O(new URLs) |

### Production Upgrade: PostgreSQL + CDN

In a real production system you would:

**Database schema:**

```sql
CREATE TABLE products (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  sku           TEXT UNIQUE NOT NULL,
  image_count   INT DEFAULT 0,
  video_count   INT DEFAULT 0,
  thumbnail_url TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE media (
  id          SERIAL PRIMARY KEY,
  product_id  UUID REFERENCES products(id),
  type        VARCHAR(5) CHECK (type IN ('image','video')),
  url         TEXT NOT NULL,
  position    INT DEFAULT 0
);

CREATE INDEX ON products(created_at DESC);
CREATE INDEX ON media(product_id);
```

**List query** (fast — never touches `media` table):
```sql
SELECT id, name, sku, image_count, video_count, thumbnail_url, created_at
FROM products
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;
```

**Detail query:**
```sql
SELECT p.*, m.type, m.url
FROM products p
LEFT JOIN media m ON m.product_id = p.id
WHERE p.id = $1
ORDER BY m.type, m.position;
```

**CDN:** `thumbnail_url` and all media URLs would be CDN-signed URLs. The API stores only the path; the CDN base URL is injected at response time — enabling cache-busting and multi-region delivery without DB migrations.

---

## Port

The server runs on **port 3000** by default. Override with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

