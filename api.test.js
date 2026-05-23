/**
 * API Tests — run with: node tests/api.test.js
 * No external test framework required.
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ─── Test suites ────────────────────────────────────────────────────────────

async function testCreateProduct() {
  console.log('\n── POST /products ──────────────────────────────────');

  // Happy path
  let r = await req('POST', '/products', {
    name: 'Widget A',
    sku: 'SKU-001',
    image_urls: ['https://cdn.example.com/img1.jpg', 'https://cdn.example.com/img2.jpg'],
    video_urls: ['https://cdn.example.com/vid1.mp4'],
  });
  assert('201 on valid create',    r.status === 201, `got ${r.status}`);
  assert('id present',             typeof r.body.id === 'string');
  assert('name correct',           r.body.name === 'Widget A');
  assert('sku correct',            r.body.sku === 'SKU-001');
  assert('image_count = 2',        r.body.image_count === 2);
  assert('video_count = 1',        r.body.video_count === 1);
  assert('thumbnail_url set',      r.body.thumbnail_url === 'https://cdn.example.com/img1.jpg');
  assert('created_at present',     typeof r.body.created_at === 'string');

  // Duplicate SKU → 409
  r = await req('POST', '/products', { name: 'Widget A Copy', sku: 'SKU-001' });
  assert('409 on duplicate SKU',   r.status === 409, `got ${r.status}`);

  // Missing name → 400
  r = await req('POST', '/products', { sku: 'SKU-NO-NAME' });
  assert('400 on missing name',    r.status === 400, `got ${r.status}`);

  // Empty name → 400
  r = await req('POST', '/products', { name: '  ', sku: 'SKU-BLANK' });
  assert('400 on blank name',      r.status === 400, `got ${r.status}`);

  // Missing sku → 400
  r = await req('POST', '/products', { name: 'No SKU' });
  assert('400 on missing sku',     r.status === 400, `got ${r.status}`);

  // Invalid URL → 400
  r = await req('POST', '/products', {
    name: 'Bad URL', sku: 'SKU-BADURL',
    image_urls: ['not-a-url'],
  });
  assert('400 on invalid URL',     r.status === 400, `got ${r.status}`);

  // Too many URLs → 400
  r = await req('POST', '/products', {
    name: 'Too Many', sku: 'SKU-MANY',
    image_urls: Array.from({ length: 21 }, (_, i) => `https://cdn.example.com/img${i}.jpg`),
  });
  assert('400 on >20 URLs',        r.status === 400, `got ${r.status}`);

  // No media (both optional)
  r = await req('POST', '/products', { name: 'No Media', sku: 'SKU-NOMEDIA' });
  assert('201 with no media',      r.status === 201, `got ${r.status}`);
  assert('thumbnail_url null',     r.body.thumbnail_url === null);

  return r.body.id; // return id for later tests (won't be useful here; we need SKU-001 id)
}

async function testListProducts() {
  console.log('\n── GET /products ───────────────────────────────────');

  let r = await req('GET', '/products');
  assert('200 on list',            r.status === 200, `got ${r.status}`);
  assert('items array present',    Array.isArray(r.body.items));
  assert('total present',          typeof r.body.total === 'number');
  assert('limit present',          typeof r.body.limit === 'number');
  assert('offset present',         typeof r.body.offset === 'number');

  // Must NOT contain image_urls / video_urls
  if (r.body.items.length > 0) {
    const item = r.body.items[0];
    assert('no image_urls in list', !('image_urls' in item), 'image_urls leaked into list');
    assert('no video_urls in list', !('video_urls' in item), 'video_urls leaked into list');
    assert('image_count present',   typeof item.image_count === 'number');
    assert('video_count present',   typeof item.video_count === 'number');
  }

  // Pagination
  r = await req('GET', '/products?limit=1&offset=0');
  assert('limit=1 returns 1 item', r.body.items.length === 1);

  r = await req('GET', '/products?limit=200'); // exceeds max
  assert('limit capped at 100',    r.body.limit === 100);
}

async function testGetProduct() {
  console.log('\n── GET /products/:id ───────────────────────────────');

  // Create a product to fetch
  let r = await req('POST', '/products', {
    name: 'Detail Test',
    sku: 'SKU-DETAIL',
    image_urls: ['https://cdn.example.com/d1.jpg'],
    video_urls: ['https://cdn.example.com/d1.mp4'],
  });
  const id = r.body.id;

  r = await req('GET', `/products/${id}`);
  assert('200 on detail',          r.status === 200, `got ${r.status}`);
  assert('image_urls present',     Array.isArray(r.body.image_urls));
  assert('video_urls present',     Array.isArray(r.body.video_urls));
  assert('image_urls correct',     r.body.image_urls[0] === 'https://cdn.example.com/d1.jpg');

  // 404 on unknown id
  r = await req('GET', '/products/nonexistent-id-xyz');
  assert('404 on unknown id',      r.status === 404, `got ${r.status}`);

  return id;
}

async function testAddMedia(productId) {
  console.log('\n── POST /products/:id/media ────────────────────────');

  // Append media
  let r = await req('POST', `/products/${productId}/media`, {
    image_urls: ['https://cdn.example.com/extra1.jpg'],
    video_urls: ['https://cdn.example.com/extra1.mp4'],
  });
  assert('200 on media append',       r.status === 200, `got ${r.status}`);
  assert('image_count incremented',   r.body.image_count === 2, `got ${r.body.image_count}`);
  assert('video_count incremented',   r.body.video_count === 2, `got ${r.body.video_count}`);
  assert('all image_urls present',    r.body.image_urls.length === 2);

  // 404 on unknown product
  r = await req('POST', '/products/bad-id/media', {
    image_urls: ['https://cdn.example.com/x.jpg'],
  });
  assert('404 on unknown product',   r.status === 404, `got ${r.status}`);

  // 400 on empty body
  r = await req('POST', `/products/${productId}/media`, {});
  assert('400 on empty media body',  r.status === 400, `got ${r.status}`);

  // 400 on invalid URL
  r = await req('POST', `/products/${productId}/media`, {
    image_urls: ['ftp://bad-scheme.com/img.jpg'],
  });
  assert('400 on invalid URL in media', r.status === 400, `got ${r.status}`);
}

// ─── Runner ─────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nRunning API tests against ${BASE_URL}\n`);

  try {
    await testCreateProduct();
    await testListProducts();
    const detailId = await testGetProduct();
    await testAddMedia(detailId);
  } catch (err) {
    console.error('\nFATAL:', err.message);
    process.exit(1);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
