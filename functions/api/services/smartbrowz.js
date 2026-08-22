// smartbrowz.js — HTML to PDF via Catalyst SmartBrowz.
//
// The briefing export returned HTML and was honestly labelled "print-ready" because
// SmartBrowz was believed to be unprovisioned. It is provisioned; the MCP Browser Grid call
// that suggested otherwise was failing for its own reasons.
//
// Two constraints shape this file:
//
// 1. The installed SDK is 1.6.0 and has no smartbrowz module -- it arrived in 3.x. Upgrading
//    across a major version on a live, submitted application would put the Data Store, Cache
//    and Zia paths at risk for one feature. So the contract is READ from 3.4.0 and called
//    over raw HTTPS here: POST /browser360/v1/project/{id}/convert with
//    { html | url, output_options: { output_type: 'pdf' } }.
//
// 2. The credential comes from request headers, as it does for Data Store, Cache and Zia.
//    Both x-zc-admin-cred-token and x-zc-project-secret-key are required.
const https = require('https');

const HOST = 'api.catalyst.zoho.in';
const API_VERSION = 'v1';
let lastError = null;

function creds(req) {
  const h = (req && req.headers) || {};
  const token = h['x-zc-admin-cred-token'] || h['x-zc-user-cred-token'];
  const secret = h['x-zc-project-secret-key'];
  const projectId = h['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID;
  if (!token || !secret || !projectId) return null;
  return { token, secret, projectId };
}

function status() {
  return { configured: true, host: HOST, transport: 'raw HTTPS (SDK 1.6.0 has no smartbrowz)', lastError };
}

/**
 * Render HTML to a PDF buffer. Returns null when SmartBrowz is unreachable so the caller
 * can fall back to serving the HTML rather than failing the export outright.
 */
function convertToPdf(req, html, pdfOptions = {}, pageOptions = {}) {
  return new Promise((resolve) => {
    const c = creds(req);
    if (!c) { lastError = 'no credential headers'; return resolve(null); }
    const payload = JSON.stringify({
      html,
      output_options: { output_type: 'pdf' },
      // Deliberately minimal. A margin of '14mm' was rejected with
      // "bottom cannot be less than 0" -- the field is numeric, not a CSS length -- and the
      // briefing HTML already sets its own page padding, so there is nothing to gain from
      // fighting an undocumented option shape.
      pdf_options: pdfOptions,
      page_options: pageOptions,
    });
    const rq = https.request({
      hostname: HOST,
      path: `/browser360/${API_VERSION}/project/${c.projectId}/convert`,
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${c.token}`,
        'X-ZC-PROJECT-SECRET-KEY': c.secret,
        'CATALYST-ORG': process.env.CATALYST_ORG_ID || '60078029367',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      // The response is the PDF itself, so collect binary rather than text.
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300 && buf.slice(0, 4).toString() === '%PDF') {
          lastError = null;
          return resolve(buf);
        }
        lastError = `convert -> ${res.statusCode}: ${buf.slice(0, 200).toString()}`;
        resolve(null);
      });
    });
    rq.on('error', (e) => { lastError = `net: ${e.message}`; resolve(null); });
    rq.write(payload);
    rq.end();
  });
}

module.exports = { convertToPdf, status, HOST };
