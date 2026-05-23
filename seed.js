/**
 * Seed script — optional, for local performance testing only.
 * Run: node src/seed.js
 *
 * Creates 1,000 products each with 10 image URLs and 2 video URLs
 * via the running API so GET /products?limit=20 can be stress-tested.
 *
 * Usage:
 *   1. Start the server: npm start
 *   2. In another terminal: node src/seed.js
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const PRODUCTS  = 1000;
const IMAGES_EACH = 10;
const VIDEOS_EACH = 2;

async function seed() {
  console.log(`Seeding ${PRODUCTS} products...`);
  const start = Date.now();

  const batch = [];
  for (let i = 1; i <= PRODUCTS; i++) {
    batch.push(fetch(`${BASE_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Widget ${i}`,
        sku: `SKU-${String(i).padStart(5, '0')}`,
        image_urls: Array.from({ length: IMAGES_EACH }, (_, j) =>
          `https://cdn.example.com/products/sku-${i}/img-${j + 1}.jpg`),
        video_urls: Array.from({ length: VIDEOS_EACH }, (_, j) =>
          `https://cdn.example.com/products/sku-${i}/video-${j + 1}.mp4`),
      }),
    }));

    // Send in batches of 50 to avoid overwhelming the event loop
    if (i % 50 === 0) {
      await Promise.all(batch.splice(0));
      process.stdout.write(`\r  ${i} / ${PRODUCTS}`);
    }
  }
  if (batch.length) await Promise.all(batch);

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\nDone! ${PRODUCTS} products seeded in ${elapsed}s`);
  console.log(`Test: curl "${BASE_URL}/products?limit=20"`);
}

seed().catch(err => { console.error(err); process.exit(1); });
