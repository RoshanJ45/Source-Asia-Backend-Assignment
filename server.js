const express = require('express');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────────────
const productsRouter = require('./routes');
app.use('/products', productsRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Product Catalog API listening on http://localhost:${PORT}`);
});

module.exports = app; // for testing
