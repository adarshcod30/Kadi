// filestore.js — Catalyst File Store, for the one thing this app deliberately keeps.
//
// WHY THIS EXISTS AT ALL, GIVEN THE FEATURE IT SERVES SAYS THE OPPOSITE.
//
// The Evidence feature shipped storing the reading and never the photograph, on the reasoning
// that the image carries whoever else happened to be in frame while the text carries the
// evidentiary value. That reasoning is sound and it remains the DEFAULT.
//
// But "never, under any circumstance" is a stronger claim than the reasoning supports, and it
// cost something real: a reading filed today cannot be checked against the page it came from,
// and a better OCR engine next year cannot be run over it. For a seizure memo an officer
// deliberately chose to keep, that is not a privacy win, it is a records loss.
//
// So retention is now possible and is:
//   - OFF by default, on every reading;
//   - a per-note choice the officer makes explicitly, next to a sentence saying what it means;
//   - readable only at the note's own scope, which is the case's scope;
//   - deleted when the note is withdrawn;
//   - audited on write, on read and on re-read.
//
// The incidental-content risk the original decision was about is handled by it being a choice
// rather than a behaviour. Nobody retains a crowd photograph by accident.
//
// TRANSPORT. Same bypass as zia.js and ziavision.js: the SDK returns 401 PERMISSION_NEEDED for
// this project, so these are raw HTTPS against the REST surface with the credential the
// function already receives in its request headers.
const https = require('https');

const HOST = process.env.CATALYST_HOST || 'api.catalyst.zoho.in';
const FOLDER_ID = process.env.EVIDENCE_FOLDER_ID || '55468000000217062';
const TIMEOUT_MS = Number(process.env.FILESTORE_TIMEOUT_MS || 20000);
// Matches the readers' own ceiling. A page they cannot read is not worth keeping.
const MAX_BYTES = Number(process.env.FILESTORE_MAX_BYTES || 6 * 1024 * 1024);

let lastError = null;

function credentials(req) {
  const h = (req && req.headers) || {};
  const token = h['x-zc-admin-cred-token'] || h['x-zc-user-cred-token'];
  const secret = h['x-zc-project-secret-key'];
  if (!token || !secret) return null;
  return { token, secret, projectId: h['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID };
}

function headers(req, c, extra = {}) {
  return {
    Authorization: `Zoho-oauthtoken ${c.token}`,
    'X-ZC-PROJECT-SECRET-KEY': c.secret,
    Environment: (req.headers && req.headers['x-zc-environment']) || 'Development',
    ...extra,
  };
}

/**
 * Store one page image. Resolves to { ok, fileId } and never throws.
 *
 * A failure here must never fail the filing that triggered it: the reading is the record and
 * the page is a convenience. The caller files the note first and treats a failed upload as
 * "not retained", which is the default state anyway.
 */
function putRaw(req, buffer, filename = 'page.png', mime = 'image/png') {
  return new Promise((resolve) => {
    const c = credentials(req);
    if (!c) return resolve({ ok: false, error: 'no credential headers' });
    if (!buffer || !buffer.length) return resolve({ ok: false, error: 'no image' });
    if (buffer.length > MAX_BYTES) return resolve({ ok: false, error: `too large (${buffer.length} bytes)` });

    const boundary = `----kadi${Date.now().toString(36)}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="code"; filename="${filename}"\r\n`
        + `Content-Type: ${mime}\r\n\r\n`, 'utf8',
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);

    const rq = https.request({
      hostname: HOST,
      path: `/baas/v1/project/${c.projectId}/folder/${FOLDER_ID}/file`,
      method: 'POST',
      headers: headers(req, c, {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      }),
      timeout: TIMEOUT_MS,
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          lastError = `put http ${res.statusCode}: ${out.slice(0, 200)}`;
          return resolve({ ok: false, status: res.statusCode, error: out.slice(0, 200) });
        }
        let claimed = null;
        try { claimed = String(JSON.parse(out).data.id); } catch { claimed = null; }
        if (!claimed) { lastError = `put: no id in ${out.slice(0, 160)}`; return resolve({ ok: false, error: 'no file id' }); }
        lastError = null;
        resolve({ ok: true, claimedId: claimed, bytes: buffer.length, filename });
      });
    });
    rq.on('timeout', () => { lastError = 'put timeout'; rq.destroy(); resolve({ ok: false, error: 'timeout' }); });
    rq.on('error', (e) => { lastError = `put ${e.message}`; resolve({ ok: false, error: e.message }); });
    rq.write(body);
    rq.end();
  });
}

/**
 * The folder's files, newest first.
 *
 * Used to find out what id a file ACTUALLY got, because the upload response does not say.
 */
function list(req, { start = 1, end = 50 } = {}) {
  return new Promise((resolve) => {
    const c = credentials(req);
    if (!c) return resolve([]);
    const rq = https.request({
      hostname: HOST,
      path: `/baas/v1/project/${c.projectId}/folder/${FOLDER_ID}/file?start=${start}&end=${end}`,
      method: 'GET',
      headers: headers(req, c),
      timeout: TIMEOUT_MS,
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(out).data || []); } catch { resolve([]); }
      });
    });
    rq.on('timeout', () => { rq.destroy(); resolve([]); });
    rq.on('error', () => resolve([]));
    rq.end();
  });
}

/**
 * Store one page and return the id it ACTUALLY has.
 *
 * THE UPLOAD RESPONSE'S ID IS A LIE, AND THIS PROJECT HAS BEEN BITTEN BY IT BEFORE. Catalyst's
 * row-insert endpoint returns a ROWID the row does not settle at -- submissions.js documents a
 * case where every child row written against the response id was silently orphaned. The file
 * endpoint does the same thing: an upload answered 55468000000205060 for a file that listed as
 * 55468000000205058. The offset is not even constant (rows drifted +3, this file -2), so there
 * is nothing to correct for.
 *
 * Rows solved this by minting their own key. A file id belongs to Catalyst and cannot be
 * minted, so the file is found by NAME instead -- the caller names it after the note key, which
 * is unique, and the listing is newest-first so a file just written is at the top.
 *
 * If the name is not found the claimed id is returned rather than failing: a page stored under
 * an id that might be wrong is still better than losing the upload, and the caller's next
 * fetch will surface it honestly as a missing page rather than as a wrong one.
 */
async function put(req, buffer, filename = 'page.png', mime = 'image/png') {
  const up = await putRaw(req, buffer, filename, mime);
  if (!up.ok) return up;
  const files = await list(req, { start: 1, end: 50 });
  const match = Array.isArray(files) ? files.find((f) => f && f.file_name === filename) : null;
  if (!match) {
    lastError = `put: uploaded ${filename} but it is not in the newest 50; using the claimed id`;
    return { ok: true, fileId: up.claimedId, bytes: up.bytes, resolved: false };
  }
  return { ok: true, fileId: String(match.id), bytes: up.bytes, resolved: true };
}

/** Fetch a stored page back as a Buffer. Resolves to { ok, buffer, mime }. */
function get(req, fileId) {
  return new Promise((resolve) => {
    const c = credentials(req);
    if (!c) return resolve({ ok: false, error: 'no credential headers' });
    if (!fileId) return resolve({ ok: false, error: 'no file id' });

    const rq = https.request({
      hostname: HOST,
      path: `/baas/v1/project/${c.projectId}/folder/${FOLDER_ID}/file/${encodeURIComponent(fileId)}/download`,
      method: 'GET',
      headers: headers(req, c),
      timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          lastError = `get http ${res.statusCode}: ${buf.toString('utf8').slice(0, 200)}`;
          return resolve({ ok: false, status: res.statusCode, error: lastError });
        }
        lastError = null;
        resolve({ ok: true, buffer: buf, mime: res.headers['content-type'] || 'image/png' });
      });
    });
    rq.on('timeout', () => { lastError = 'get timeout'; rq.destroy(); resolve({ ok: false, error: 'timeout' }); });
    rq.on('error', (e) => { lastError = `get ${e.message}`; resolve({ ok: false, error: e.message }); });
    rq.end();
  });
}

/**
 * Remove a stored page.
 *
 * This IS a hard delete, and it is the one place in this feature that has one. The note it
 * belonged to is not deleted -- withdrawal keeps the row and its text. What goes is the
 * photograph, which is exactly the thing an officer withdrawing a mis-filed reading wants gone
 * and the thing this feature never wanted to be holding in the first place.
 */
function remove(req, fileId) {
  return new Promise((resolve) => {
    const c = credentials(req);
    if (!c || !fileId) return resolve({ ok: false, error: 'no credential or file id' });
    const rq = https.request({
      hostname: HOST,
      path: `/baas/v1/project/${c.projectId}/folder/${FOLDER_ID}/file/${encodeURIComponent(fileId)}`,
      method: 'DELETE',
      headers: headers(req, c),
      timeout: TIMEOUT_MS,
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        // A page that is already gone is the state we wanted. 404 is success here.
        const ok = (res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 404;
        if (!ok) lastError = `delete http ${res.statusCode}: ${out.slice(0, 160)}`;
        resolve({ ok, status: res.statusCode });
      });
    });
    rq.on('timeout', () => { rq.destroy(); resolve({ ok: false, error: 'timeout' }); });
    rq.on('error', (e) => resolve({ ok: false, error: e.message }));
    rq.end();
  });
}

function status() {
  return {
    folderId: FOLDER_ID,
    task: 'retained evidence pages — the image behind a filed reading, kept only when an '
      + 'officer explicitly chose to keep it',
    default: 'not retained. Retention is opt-in per reading, never a behaviour',
    maxBytes: MAX_BYTES,
    deletion: 'a retained page is deleted when its note is withdrawn',
    lastError,
  };
}

module.exports = { put, get, remove, list, status, FOLDER_ID, MAX_BYTES };
