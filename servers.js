'use strict';

const http        = require('http');
const { attempt, stats, WINDOW_MS, LIMIT } = require('./rateLimiter');

const PORT = process.env.PORT || 3000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function send(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end',  ()    => resolve(raw));
    req.on('error', reject);
  });
}

function validateUserId(userId) {
  // Must be a non-empty string containing only alphanumerics, hyphens, underscores, dots.
  if (typeof userId !== 'string') return 'user_id must be a string';
  if (userId.trim() === '')        return 'user_id must not be empty or whitespace';
  if (!/^[\w.\-]+$/.test(userId)) return 'user_id may only contain letters, digits, hyphens, underscores, and dots';
  return null; // valid
}

// ─── Route handlers ─────────────────────────────────────────────────────────

/**
 * POST /request
 *
 * Body (JSON): { "user_id": "<string>" }
 *
 * 200 – accepted
 * 400 – invalid input
 * 429 – rate limit exceeded
 */
async function handleRequest(req, res) {
  // Parse body.
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    return send(res, 400, {
      error:   'Bad Request',
      message: 'Request body must be valid JSON.',
    });
  }

  // Validate user_id.
  const userId   = body?.user_id;
  const idError  = validateUserId(userId);
  if (idError) {
    return send(res, 400, {
      error:   'Bad Request',
      message: idError,
    });
  }

  // Attempt (synchronous critical section inside attempt()).
  const result = attempt(userId);

  if (result.accepted) {
    return send(res, 200, {
      status:              'accepted',
      user_id:             userId,
      accepted_in_window:  result.acceptedInWindow,
      rejected_cumulative: result.rejectedCumulative,
      window_seconds:      WINDOW_MS / 1000,
      limit:               LIMIT,
    });
  } else {
    return send(res, 429, {
      error:               'Too Many Requests',
      message:             `Rate limit exceeded. Maximum ${LIMIT} requests per ${WINDOW_MS / 1000}s window.`,
      user_id:             userId,
      accepted_in_window:  result.acceptedInWindow,
      rejected_cumulative: result.rejectedCumulative,
      window_seconds:      WINDOW_MS / 1000,
      limit:               LIMIT,
    });
  }
}

/**
 * GET /stats/:userId
 *
 * Returns the current counters for a user (does NOT consume a request slot).
 */
function handleStats(req, res, userId) {
  const idError = validateUserId(userId);
  if (idError) {
    return send(res, 400, { error: 'Bad Request', message: idError });
  }

  const s = stats(userId);
  if (!s) {
    return send(res, 404, {
      error:   'Not Found',
      message: `No data found for user_id: ${userId}`,
    });
  }

  return send(res, 200, {
    user_id:             userId,
    accepted_in_window:  s.acceptedInWindow,
    rejected_cumulative: s.rejectedCumulative,
    window_seconds:      WINDOW_MS / 1000,
    limit:               LIMIT,
  });
}

// ─── Router ─────────────────────────────────────────────────────────────────

async function router(req, res) {
  const url    = req.url;
  const method = req.method;

  // POST /request
  if (method === 'POST' && url === '/request') {
    return handleRequest(req, res);
  }

  // GET /stats/:userId
  const statsMatch = url.match(/^\/stats\/(.+)$/);
  if (method === 'GET' && statsMatch) {
    return handleStats(req, res, decodeURIComponent(statsMatch[1]));
  }

  // GET /health
  if (method === 'GET' && url === '/health') {
    return send(res, 200, { status: 'ok' });
  }

  // 404
  return send(res, 404, {
    error:   'Not Found',
    message: `No route: ${method} ${url}`,
  });
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (err) {
    console.error('Unhandled error:', err);
    // Guard against double-sending if headers already sent.
    if (!res.headersSent) {
      send(res, 500, { error: 'Internal Server Error', message: err.message });
    }
  }
});

server.listen(PORT, () => {
  console.log(`Rate-limiter server running on http://localhost:${PORT}`);
  console.log(`Limit: ${LIMIT} requests / ${WINDOW_MS / 1000}s (sliding window) per user_id`);
});

module.exports = server; // exported for testing
