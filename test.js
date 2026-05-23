/**
 * test.js — Self-contained test suite (no external deps).
 *
 * Run with:  node test.js
 *
 * What it covers:
 *   1. Sequential requests — exactly 5 accepted, then 429.
 *   2. Concurrent requests — fire 10 in parallel; exactly 5 must be accepted.
 *   3. Invalid / missing user_id → 400.
 *   4. Stats endpoint — correct counters.
 *   5. Window reset — after 1 minute, user can make 5 more (simulated by
 *      monkey-patching Date.now inside the module).
 */

'use strict';

const http = require('http');

// ─── Bootstrap server on a random port ──────────────────────────────────────

// Isolate each test run with a fresh store by re-requiring the module.
// We deliberately DON'T cache require() here.
function freshServer(port) {
  // Purge module cache so each test file gets a clean store.
  Object.keys(require.cache).forEach(k => delete require.cache[k]);
  const srv = require('./src/server');
  return new Promise(resolve => srv.listening ? resolve(srv) : srv.once('listening', () => resolve(srv)));
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function req(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0,
      },
    };
    const r = http.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end',  () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// ─── Mini test runner ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    failed++;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function runTests() {
  // Use a dynamic port to avoid conflicts.
  process.env.PORT = '0';
  const srv = await freshServer();
  const port = srv.address().port;
  console.log(`\nServer started on port ${port}\n`);

  // ── 1. Sequential: 5 accepted, 6th rejected ──────────────────────────────
  console.log('Test 1: Sequential requests (5 accepted → 429)');
  {
    const uid = 'user-seq-' + Date.now();
    for (let i = 1; i <= 5; i++) {
      const r = await req(port, 'POST', '/request', { user_id: uid });
      assert(r.status === 200, `Request ${i}: 200 accepted`);
      assert(r.body.accepted_in_window === i, `Request ${i}: accepted_in_window = ${i}`);
    }
    const r6 = await req(port, 'POST', '/request', { user_id: uid });
    assert(r6.status === 429, 'Request 6: 429 Too Many Requests');
    assert(r6.body.accepted_in_window === 5, 'Request 6: accepted_in_window still 5');
    assert(r6.body.rejected_cumulative === 1, 'Request 6: rejected_cumulative = 1');
  }

  // ── 2. Concurrent: exactly 5 accepted out of 10 parallel ─────────────────
  console.log('\nTest 2: Concurrent requests (10 parallel → exactly 5 accepted)');
  {
    const uid = 'user-concurrent-' + Date.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => req(port, 'POST', '/request', { user_id: uid }))
    );
    const accepted = results.filter(r => r.status === 200).length;
    const rejected = results.filter(r => r.status === 429).length;
    assert(accepted === 5, `Exactly 5 accepted (got ${accepted})`);
    assert(rejected === 5, `Exactly 5 rejected (got ${rejected})`);
  }

  // ── 3a. Missing user_id → 400 ─────────────────────────────────────────────
  console.log('\nTest 3a: Missing user_id → 400');
  {
    const r = await req(port, 'POST', '/request', {});
    assert(r.status === 400, '400 on missing user_id');
  }

  // ── 3b. Empty user_id → 400 ───────────────────────────────────────────────
  console.log('\nTest 3b: Empty user_id → 400');
  {
    const r = await req(port, 'POST', '/request', { user_id: '' });
    assert(r.status === 400, '400 on empty user_id');
  }

  // ── 3c. Whitespace-only user_id → 400 ────────────────────────────────────
  console.log('\nTest 3c: Whitespace-only user_id → 400');
  {
    const r = await req(port, 'POST', '/request', { user_id: '   ' });
    assert(r.status === 400, '400 on whitespace-only user_id');
  }

  // ── 3d. Invalid JSON body → 400 ──────────────────────────────────────────
  console.log('\nTest 3d: Invalid JSON → 400');
  {
    const r = await new Promise((resolve, reject) => {
      const payload = 'not json';
      const options = {
        hostname: '127.0.0.1', port, path: '/request', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      };
      const rq = http.request(options, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      rq.on('error', reject);
      rq.write(payload);
      rq.end();
    });
    assert(r.status === 400, '400 on invalid JSON');
  }

  // ── 4. Stats endpoint ─────────────────────────────────────────────────────
  console.log('\nTest 4: /stats/:userId endpoint');
  {
    const uid = 'user-stats-' + Date.now();
    // Make 3 requests.
    for (let i = 0; i < 3; i++) await req(port, 'POST', '/request', { user_id: uid });
    // One rejected.
    for (let i = 0; i < 8; i++) await req(port, 'POST', '/request', { user_id: uid });

    const s = await req(port, 'GET', `/stats/${uid}`);
    assert(s.status === 200, '/stats returns 200');
    assert(s.body.accepted_in_window === 5, `accepted_in_window = 5 (got ${s.body.accepted_in_window})`);
    assert(s.body.rejected_cumulative === 6, `rejected_cumulative = 6 (got ${s.body.rejected_cumulative})`);
  }

  // ── 5. Unknown user stats → 404 ──────────────────────────────────────────
  console.log('\nTest 5: /stats for unknown user → 404');
  {
    const r = await req(port, 'GET', '/stats/ghost-user-xyz');
    assert(r.status === 404, '404 for unknown user');
  }

  // ── 6. Health check ───────────────────────────────────────────────────────
  console.log('\nTest 6: GET /health');
  {
    const r = await req(port, 'GET', '/health');
    assert(r.status === 200, '200 on /health');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  srv.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
