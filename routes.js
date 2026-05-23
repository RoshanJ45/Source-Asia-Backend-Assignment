const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { productsMap, mediaMap, skuIndex, insertionOrder } = require('./store');
const { validateCreateProduct, validateAddMedia } = require('./validation');

const router = express.Router();

/**
 * POST /products
 * Create a new product.
 */
router.post('/', (req, res) => {
  const { name, sku, image_urls = [], video_urls = [] } = req.body || {};

  // Validation
  const errors = validateCreateProduct({ name, sku, image_urls, video_urls });
  if (errors.length) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const trimmedSku = sku.trim();
  const trimmedName = name.trim();

  // Duplicate SKU check
  if (skuIndex.has(trimmedSku)) {
    return res.status(409).json({
      error: 'Conflict',
      message: `A product with sku "${trimmedSku}" already exists`,
    });
  }

  const id = uuidv4();
  const created_at = new Date().toISOString();

  // thumbnail_url: first image URL if present, else null
  const thumbnail_url = image_urls.length > 0 ? image_urls[0] : null;

  // List projection (no URL arrays)
  const listRecord = {
    id,
    name: trimmedName,
    sku: trimmedSku,
    image_count: image_urls.length,
    video_count: video_urls.length,
    thumbnail_url,
    created_at,
  };

  // Media stored separately
  const mediaRecord = {
    image_urls: [...image_urls],
    video_urls: [...video_urls],
  };

  productsMap.set(id, listRecord);
  mediaMap.set(id, mediaRecord);
  skuIndex.set(trimmedSku, id);
  insertionOrder.push(id);

  return res.status(201).json({
    id,
    name: trimmedName,
    sku: trimmedSku,
    image_urls: mediaRecord.image_urls,
    video_urls: mediaRecord.video_urls,
    image_count: listRecord.image_count,
    video_count: listRecord.video_count,
    thumbnail_url,
    created_at,
  });
});

/**
 * GET /products
 * List / grid — fast, no URL arrays returned.
 *
 * Query params:
 *   limit  (default: 20, max: 100)
 *   offset (default: 0)
 *
 * Alternatively page / page_size are also supported for convenience.
 */
router.get('/', (req, res) => {
  // Support both offset/limit and page/page_size
  let limit  = parseInt(req.query.limit  || req.query.page_size || '20', 10);
  let offset = parseInt(req.query.offset || '0', 10);

  if (req.query.page) {
    const page = parseInt(req.query.page, 10);
    if (!isNaN(page) && page >= 1) {
      offset = (page - 1) * limit;
    }
  }

  // Defaults & caps
  if (isNaN(limit)  || limit  < 1)   limit  = 20;
  if (isNaN(offset) || offset < 0)   offset = 0;
  if (limit > 100) limit = 100;

  const total = insertionOrder.length;
  const pageIds = insertionOrder.slice(offset, offset + limit);

  // Only list-projection fields — NO image_urls / video_urls
  const items = pageIds.map(id => productsMap.get(id));

  return res.json({
    total,
    limit,
    offset,
    items,
  });
});

/**
 * GET /products/:id
 * Detail page — returns full product including all URL arrays.
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;

  const listRecord = productsMap.get(id);
  if (!listRecord) {
    return res.status(404).json({ error: 'Not Found', message: `Product "${id}" not found` });
  }

  const media = mediaMap.get(id);

  return res.json({
    ...listRecord,
    image_urls: media.image_urls,
    video_urls: media.video_urls,
  });
});

/**
 * POST /products/:id/media
 * Append new image/video URLs to an existing product.
 */
router.post('/:id/media', (req, res) => {
  const { id } = req.params;

  const listRecord = productsMap.get(id);
  if (!listRecord) {
    return res.status(404).json({ error: 'Not Found', message: `Product "${id}" not found` });
  }

  const { image_urls = [], video_urls = [] } = req.body || {};

  // Validation
  const errors = validateAddMedia({ image_urls, video_urls });
  if (errors.length) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const media = mediaMap.get(id);

  // Append URLs
  media.image_urls.push(...image_urls);
  media.video_urls.push(...video_urls);

  // Update counts and thumbnail in list projection
  listRecord.image_count = media.image_urls.length;
  listRecord.video_count = media.video_urls.length;
  if (!listRecord.thumbnail_url && media.image_urls.length > 0) {
    listRecord.thumbnail_url = media.image_urls[0];
  }

  return res.json({
    ...listRecord,
    image_urls: media.image_urls,
    video_urls: media.video_urls,
  });
});

module.exports = router;
