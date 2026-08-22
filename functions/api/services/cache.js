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

// The SDK path below returns 401 for every scope, because initialize(req) does not pick up
// the credential Catalyst actually supplies -- it arrives in REQUEST HEADERS, not the
// environment. datastore.js proved raw HTTPS with x-zc-admin-cred-token AND
// x-zc-project-secret-key works; the token alone gives 404 INVALID_RESOURCE.
const https = require('https');

function creds(req) {
  const h = (req && req.headers) || {};
  const token = h['x-zc-admin-cred-token'] || h['x-zc-user-cred-token'];
  const secret = h['x-zc-project-secret-key'];
  const projectId = h['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID;
  if (!token || !secret || !projectId) return null;
  return { token, secret, projectId, env: h['x-zc-environment'] || 'Development' };
}

function httpCache(req, method, path, body) {
  return new Promise((resolve) => {
    const c = creds(req);
    if (!c) { lastError = 'no credential headers'; return resolve(null); }
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Zoho-oauthtoken ${c.token}`,
      Environment: c.env,
      'X-ZC-PROJECT-SECRET-KEY': c.secret,
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const rq = https.request({
      hostname: 'api.catalyst.zoho.in',
      path: `/baas/v1/project/${c.projectId}${path}`,
      method, headers,
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { return resolve(JSON.parse(out)); } catch { return resolve(null); }
        }
        lastError = `${method} ${path} -> ${res.statusCode}: ${out.slice(0, 140)}`;
        resolve(null);
      });
    });
    rq.on('error', (e) => { lastError = `net: ${e.message}`; resolve(null); });
    if (payload) rq.write(payload);
    rq.end();
  });
}

function segment(req) {
  if (!catalyst) { lastError = 'sdk-not-loaded'; return null; }
  if (!req) { lastError = 'no-request'; return null; }
  try {
    // Scope must be set at initialize time — the second argument. Without it the request
    // resolves to the *user* credential and Cache writes come back 401 PERMISSION_NEEDED,
    // because an anonymous HTTP call carries no signed-in user. KPIs are project-owned
    // data rather than user data, so admin is the correct scope here.
    const app = catalyst.initialize(req, { scope: 'admin' });
    // Pass the id as a STRING. It is 17 digits; Number() on a Catalyst id is the same
    // trap that corrupted the project id earlier, and the SDK accepts string | number.
    return app.cache().segment(SEGMENT_ID);
  } catch (e) {
    lastError = `initialize: ${e && e.message ? e.message : e}`;
    return null; // not running inside Catalyst
  }
}

function diag() {
  return { sdkLoaded: !!catalyst, segmentId: SEGMENT_ID, lastError };
}

async function get(req, key) {
  const viaHttp = await httpCache(req, 'GET',
    `/segment/${SEGMENT_ID}/cache?cacheKey=${encodeURIComponent(key)}`);
  if (viaHttp && viaHttp.data) {
    const v = viaHttp.data.cache_value ?? viaHttp.data.value;
    if (v) { try { return JSON.parse(v); } catch { /* fall through */ } }
  }
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
  const viaHttp = await httpCache(req, 'POST', `/segment/${SEGMENT_ID}/cache`, {
    cache_name: key, // NOT cache_key -- confirmed against the live segment
    cache_value: JSON.stringify(value),
    expiry_in_hours: TTL_HOURS,
  });
  if (viaHttp) return true;
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

module.exports = { get, put, through, diag, httpCache, SEGMENT_ID, TTL_HOURS };
