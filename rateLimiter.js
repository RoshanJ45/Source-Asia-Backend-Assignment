/**
 * Sliding-window rate limiter (in-memory, per user_id).
 *
 * Algorithm: Sliding Window Log
 *   - Each user_id has a log of timestamps (ms) for accepted requests.
 *   - On every incoming request we:
 *       1. Evict timestamps older than (now - WINDOW_MS).
 *       2. If log.length < LIMIT  → accept, push timestamp, increment accepted.
 *       3. Otherwise             → reject, increment rejected (per-window).
 *
 * Concurrency safety:
 *   JavaScript is single-threaded; the event loop processes one callback at a
 *   time, so there is NO true data race on the in-memory store.
 *   However, async I/O in the request handler could allow interleaving if we
 *   awaited between the "check" and "update" steps.  To prevent that we keep
 *   the entire check-and-update critical section SYNCHRONOUS (no awaits), so
 *   it runs atomically inside one tick.  This guarantees at most LIMIT accepts
 *   per window even under high-concurrency parallel requests.
 */

'use strict';

const WINDOW_MS = 60_000; // 1 minute
const LIMIT     = 5;       // max accepted requests per window per user_id

/**
 * @typedef {Object} UserRecord
 * @property {number[]} timestamps   - Epoch-ms of each accepted request still inside the window.
 * @property {number}   accepted     - Total accepted in the current window (evicted on next check).
 * @property {number}   rejected     - Cumulative rejected across ALL windows (never resets).
 */

/** @type {Map<string, UserRecord>} */
const store = new Map();

/**
 * Attempt to accept a request for `userId`.
 *
 * @param {string} userId
 * @returns {{ accepted: boolean, acceptedInWindow: number, rejectedCumulative: number }}
 */
function attempt(userId) {
  const now = Date.now();

  if (!store.has(userId)) {
    store.set(userId, { timestamps: [], accepted: 0, rejected: 0 });
  }

  const record = store.get(userId);

  // --- CRITICAL SECTION (synchronous — no awaits between read and write) ---

  // 1. Slide the window: evict timestamps older than 1 minute ago.
  const cutoff = now - WINDOW_MS;
  record.timestamps = record.timestamps.filter(ts => ts > cutoff);

  // 2. Recalculate accepted count from surviving timestamps.
  record.accepted = record.timestamps.length;

  // 3. Decide.
  if (record.accepted < LIMIT) {
    record.timestamps.push(now);
    record.accepted += 1;
    return {
      accepted:             true,
      acceptedInWindow:     record.accepted,
      rejectedCumulative:   record.rejected,
    };
  } else {
    record.rejected += 1;
    return {
      accepted:             false,
      acceptedInWindow:     record.accepted,
      rejectedCumulative:   record.rejected,
    };
  }
  // --- END CRITICAL SECTION ---
}

/**
 * Return a snapshot of the current state for a user (or null if unknown).
 *
 * @param {string} userId
 * @returns {{ acceptedInWindow: number, rejectedCumulative: number } | null}
 */
function stats(userId) {
  if (!store.has(userId)) return null;
  const record = store.get(userId);
  const now    = Date.now();
  const cutoff = now - WINDOW_MS;
  const active = record.timestamps.filter(ts => ts > cutoff).length;
  return {
    acceptedInWindow:   active,
    rejectedCumulative: record.rejected,
  };
}

module.exports = { attempt, stats, WINDOW_MS, LIMIT };
