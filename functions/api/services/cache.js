// cache.js — Catalyst Cache adapter for the dashboard KPIs.
//
// The dashboard's /stats aggregates over all 40,836 FIRs on every request. It is the
// same answer for every user until the nightly pipeline reruns, so it belongs in Cache
// rather than being recomputed per hit.
//
// Runs in two environments and must not break either:
//   - deployed on Catalyst -> real Cache segment, keyed per role
//   - local dev / tests    -> no Catalyst context, so every call is a miss and the
//                             caller just computes normally
// Every failure path is swallowed deliberately: a cache is an optimisation, and an
// outage in it must never turn into a 500 on the dashboard.
let catalyst = null;
try {
  catalyst = require('zcatalyst-sdk-node');
} catch {
  catalyst = null; // SDK absent locally — treated as a permanent miss
}

const SEGMENT_ID = process.env.CATALYST_CACHE_SEGMENT_ID || '55468000000036360'; // kadi-kpi
const TTL_HOURS = 6;

let lastError = null; // surfaced by /diag/cache so a silent miss is debuggable

function segment(req) {
  if (!catalyst) { lastError = 'sdk-not-loaded'; return null; }
  if (!req) { lastError = 'no-request'; return null; }
  try {
    const app = catalyst.initialize(req);
    // The function is invoked anonymously, so the SDK defaults to the *user* credential,
    // which has no Cache write scope (401 PERMISSION_NEEDED). KPIs are project-owned data,
    // not user data, so switch to the admin credential for this component.
    if (typeof app.switchUser === 'function') app.switchUser('admin');
    // Segment id is numeric in the SDK; fall back to the default segment if unset.
    return app.cache().segment(Number(SEGMENT_ID));
  } catch (e) {
    lastError = `initialize: ${e && e.message ? e.message : e}`;
    return null; // not running inside Catalyst
  }
}

function diag() {
  return { sdkLoaded: !!catalyst, segmentId: SEGMENT_ID, lastError };
}

async function get(req, key) {
  const seg = segment(req);
  if (!seg) return null;
  try {
    const item = await seg.getValue(key);
    return item ? JSON.parse(item) : null;
  } catch (e) {
    lastError = `get: ${e && e.message ? e.message : e}`;
    return null;
  }
}

async function put(req, key, value) {
  const seg = segment(req);
  if (!seg) return false;
  try {
    await seg.put(key, JSON.stringify(value), TTL_HOURS);
    return true;
  } catch (e) {
    lastError = `put: ${e && e.message ? e.message : e}`;
    return false;
  }
}

/**
 * Serve `key` from Cache, else compute it, store it, and return it.
 * Returns { data, cached } so the response can honestly report which it was.
 */
async function through(req, key, compute) {
  const hit = await get(req, key);
  if (hit !== null) return { data: hit, cached: true };
  const data = await compute();
  await put(req, key, data);
  return { data, cached: false };
}

module.exports = { get, put, through, diag, SEGMENT_ID, TTL_HOURS };
