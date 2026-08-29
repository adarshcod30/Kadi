// ziavision.js — Zia's image services: OCR, object recognition, face detection, ID parsing.
//
// WHAT THIS IS FOR. An officer holds paper and photographs. A seizure memo, a notice, an ID
// card, a picture of recovered property. None of it is in the register, and the gap between
// "this is in my hand" and "this is in the record" is where an hour goes. These read the
// picture so that gap costs a photograph.
//
// WHAT IT DELIBERATELY DOES NOT DO, AND WHY THE LINE IS HERE.
//
// Face ANALYTICS counts faces and reports what the model sees about each. It does not identify
// anyone, and this project does not build face matching -- not as a limitation to be lifted
// later, but as a decision. Zia offers no 1:N face search, the corpus carries no photographs,
// and a "match" assembled out of neither would be a fabricated identification presented to a
// police officer as a finding. Counting how many people are in a scene photograph is a
// contemporaneous note; naming them is an accusation, and a general vision model is not
// entitled to make one.
//
// So the face call returns a COUNT and nothing that could name a person. The VLM's refusal in
// vlm.js covers the same ground from the other side.
//
// TRANSPORT. The SDK returns 401 PERMISSION_NEEDED for every Zia operation on this project --
// the credential is present in the request headers and the SDK simply does not use it. zia.js
// documents that and bypasses it with raw HTTPS; these are the same bypass, with multipart
// instead of JSON because image endpoints take a file rather than a body.
const https = require('https');

const HOST = process.env.ZIA_HOST || 'api.catalyst.zoho.in';
const TIMEOUT_MS = Number(process.env.ZIA_VISION_TIMEOUT_MS || 20000);
const MAX_BYTES = Number(process.env.ZIA_VISION_MAX_BYTES || 6 * 1024 * 1024);

// Candidate REST paths per capability, most likely first.
//
// The console documents these through its SDK samples and not as REST, and the SDK is exactly
// the thing that does not work here. Rather than pick one and hope -- which is how a voice
// named Thomas ended up in the speaker table for months -- each capability carries the paths
// worth trying and probe() reports which of them the deployment actually answers.
const PATHS = {
  // Confirmed by probe against this deployment.
  ocr: ['/ml/ocr'],
  barcode: ['/ml/barcode', '/ml/barcodescanner'],
  // The face path answers (a Zia error rather than a 404), so it exists; the others are still
  // being searched for. Order is most-likely-first and the list is what probe() reports on.
  faces: ['/ml/facedetection', '/ml/faceanalytics', '/ml/faceanalysis', '/ml/face'],
  objects: ['/ml/objectdetection', '/ml/objectanalysis', '/ml/objectrecognition', '/ml/imageanalysis', '/ml/object'],
  identity: ['/ml/identityscanner', '/ml/idscanner', '/ml/identityscan', '/ml/idscan', '/ml/identity'],
};

let lastError = null;
const resolved = {};      // capability -> the path that answered, once one has

function credentials(req) {
  const h = (req && req.headers) || {};
  const token = h['x-zc-admin-cred-token'] || h['x-zc-user-cred-token'];
  const secret = h['x-zc-project-secret-key'];
  if (!token || !secret) return null;
  return { token, secret, projectId: h['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID };
}

/** One multipart POST. Resolves to { ok, status, json|body } and never throws. */
function postImage(req, path, image, { field = 'image', filename = 'evidence.jpg', mime = 'image/jpeg', extra = {} } = {}) {
  return new Promise((resolve) => {
    const c = credentials(req);
    if (!c) return resolve({ ok: false, status: 0, error: 'no credential headers' });

    const boundary = `----kadi${Date.now().toString(36)}`;
    const parts = [];
    for (const [k, v] of Object.entries(extra)) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8',
      ));
    }
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n`
      + `Content-Type: ${mime}\r\n\r\n`, 'utf8',
    ));
    parts.push(image);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
    const body = Buffer.concat(parts);

    const rq = https.request({
      hostname: HOST,
      path: `/baas/v1/project/${c.projectId}${path}`,
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${c.token}`,
        'X-ZC-PROJECT-SECRET-KEY': c.secret,
        Environment: (req.headers && req.headers['x-zc-environment']) || 'Development',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        let json = null;
        try { json = JSON.parse(out); } catch { json = null; }
        if (!ok) lastError = `${path} http ${res.statusCode}: ${out.slice(0, 160)}`;
        resolve({ ok, status: res.statusCode, json, body: out.slice(0, 400) });
      });
    });
    rq.on('timeout', () => { lastError = `${path} timeout`; rq.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    rq.on('error', (e) => { lastError = `${path} ${e.message}`; resolve({ ok: false, status: 0, error: e.message }); });
    rq.write(body);
    rq.end();
  });
}

/**
 * Call a capability, trying its candidate paths until one answers.
 *
 * The winning path is remembered for the life of the container, so the cost of not knowing the
 * REST surface is paid once rather than on every request.
 */
async function call(req, capability, image, opts = {}) {
  if (!image || !image.length) return { ok: false, error: 'no image' };
  if (image.length > MAX_BYTES) return { ok: false, error: `image too large (${image.length} bytes)` };
  const candidates = resolved[capability] ? [resolved[capability]] : (PATHS[capability] || []);
  for (const path of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const res = await postImage(req, path, image, opts);
    if (res.ok) { resolved[capability] = path; return { ok: true, path, data: res.json ?? res.body }; }
    // A 404 means wrong path; anything else means the path was right and the call failed, so
    // stop rather than trying the next candidate and reporting its error instead.
    if (res.status && res.status !== 404) {
      return { ok: false, path, status: res.status, error: res.body || res.error };
    }
  }
  return { ok: false, error: `no endpoint answered for ${capability}`, tried: candidates };
}

/** Which capabilities this deployment actually answers. Empirical, not documented. */
async function probe(req, image) {
  const out = {};
  for (const cap of Object.keys(PATHS)) {
    // eslint-disable-next-line no-await-in-loop
    const r = await call(req, cap, image);
    out[cap] = r.ok ? { ok: true, path: r.path } : { ok: false, tried: PATHS[cap], error: String(r.error || '').slice(0, 140) };
  }
  return out;
}

function status() {
  return {
    task: 'reading evidence images — printed and handwritten text, objects in a scene, faces '
      + 'present, ID documents and barcodes',
    resolvedPaths: resolved,
    candidatePaths: PATHS,
    maxBytes: MAX_BYTES,
    lastError,
    refuses: 'identification of people. Faces are COUNTED, never matched or named — this '
      + 'project builds no face recognition and holds no gallery of photographs.',
  };
}

module.exports = { call, probe, status, PATHS };
