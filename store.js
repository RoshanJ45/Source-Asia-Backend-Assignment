/**
 * In-Memory Store
 *
 * Data model design (critical for performance):
 *
 * We maintain TWO separate maps:
 *
 *  1. productsMap  { [id]: { id, name, sku, image_count, video_count, thumbnail_url, created_at } }
 *     — "list projection": only the fields needed for GET /products list/grid responses.
 *     — No URL arrays here, so listing 1,000 products never touches the 10,000 image URLs.
 *
 *  2. mediaMap     { [id]: { image_urls: [...], video_urls: [...] } }
 *     — URL arrays stored separately, fetched ONLY for GET /products/:id (detail page).
 *
 *  3. skuIndex     { [sku]: id }
 *     — O(1) duplicate-SKU detection on create.
 *
 * Why this beats a naive single object:
 *   GET /products?limit=20  → reads from productsMap only  (O(limit))
 *   GET /products/:id       → reads productsMap + mediaMap  (O(1) each)
 *   POST /products/:id/media → mutates mediaMap only, no product rewrite
 *
 * Production upgrade path (PostgreSQL + CDN):
 *   • products table: id, name, sku, image_count, video_count, thumbnail_url, created_at
 *   • media table:    id (FK), type ENUM('image','video'), url, position
 *   • List query:     SELECT id,name,sku,image_count,video_count,thumbnail_url FROM products LIMIT $1 OFFSET $2
 *     → never joins media table, stays fast with an index on created_at
 *   • Detail query:   SELECT * FROM products p LEFT JOIN media m ON m.product_id = p.id WHERE p.id = $1
 *   • CDN:            thumbnail_url becomes a real CDN URL; image/video URLs are CDN-signed
 */

const productsMap = new Map(); // id → list projection
const mediaMap    = new Map(); // id → { image_urls, video_urls }
const skuIndex    = new Map(); // sku → id

// Ordered insertion list so pagination (offset/limit) is deterministic
const insertionOrder = [];

module.exports = { productsMap, mediaMap, skuIndex, insertionOrder };
