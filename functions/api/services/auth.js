// auth.js — real sign-in, on top of the demo role switch rather than instead of it.
//
// Two ways in, and the difference between them is the point:
//
//   DEMO      the three tier cards. No credential. Sets x-kadi-role, and the district tier
//             may switch districts freely because an evaluator needs to see all of them.
//   REAL      email + password against a provisioned account. Scope comes from the ACCOUNT,
//             not from a header, so SP Mysuru is pinned to Mysuru and cannot reach Bengaluru
//             City by editing a URL, a header, or anything else reachable from a browser.
//
// The header path survives because it is honestly labelled as a demo. What must not survive
// is a signed-in user being able to widen their own scope, which is why the token carries the
// district and station and rbac reads them from there.
//
// PASSWORDS: scrypt, per-account salt, constant-time compare. The app never stores or receives
// a plaintext password beyond the moment it verifies one.
//
// SESSIONS: an HMAC-signed, stateless token. Stateless because a Catalyst function has no
// session store worth the round trip and containers recycle constantly -- a token that
// verifies from its own signature keeps working across cold starts. It carries only what
// scope needs, is signed with a server-side secret, and expires.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const datastore = require('./datastore');

const DOMAIN = 'ksp.gov.in';
const TOKEN_TTL_HOURS = 12;
const TABLE = 'AppUser';

// ---- the signing secret ------------------------------------------------------------------
//
// It lives in the AppConfig Data Store table, not in the repository and not in the deployed
// function's env block. Both of those were considered and rejected:
//
//   env var        catalyst-config.json is how a function declares env vars, and that file is
//                  committed. A signing secret in a public repo is worse than the credential
//                  list -- those are mock passwords for a synthetic corpus, whereas the secret
//                  mints a valid DGP token with no password at all.
//   per-process    what this replaces. Every cold start generated a new key, so tokens stopped
//                  verifying and officers were silently logged out mid-session.
//
// Read once per container and cached. If Data Store is unreachable the process falls back to a
// random key, which fails CLOSED: tokens issued by that container simply will not verify
// elsewhere, rather than every deployment sharing a guessable key.
const SECRET_KEY = 'auth.signingSecret';
const FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');
let cachedSecret = null;
let secretSource = 'not-loaded';

async function loadSecret(req) {
  if (cachedSecret) return cachedSecret;
  const rows = await datastore.query(req,
    `SELECT configValue FROM AppConfig WHERE configKey = '${SECRET_KEY}'`, 'AppConfig');
  if (rows && rows.length && rows[0].configValue) {
    cachedSecret = rows[0].configValue;
    secretSource = 'datastore';
  } else {
    cachedSecret = FALLBACK_SECRET;
    secretSource = 'ephemeral-fallback';
  }
  return cachedSecret;
}

// Synchronous accessor for the signing helpers. Everything that signs or verifies runs behind
// a route that has already awaited loadSecret(), so by the time this is reached the value is
// in hand; the fallback keeps it total rather than throwing.
const SECRET = () => cachedSecret || FALLBACK_SECRET;

// ---------- provisioned accounts ----------
// Bundled with the function, so the 36 seeded logins work the moment it deploys and do not
// depend on the Data Store being reachable. Sign-ups go to Data Store; these do not need to.
let PROVISIONED = null;
function provisioned() {
  if (PROVISIONED) return PROVISIONED;
  try {
    const p = path.join(__dirname, '..', 'data', 'accounts.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    PROVISIONED = new Map((raw.accounts || []).map((a) => [String(a.email).toLowerCase(), a]));
  } catch {
    PROVISIONED = new Map();
  }
  return PROVISIONED;
}

// ---------- password hashing ----------
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `scrypt$${salt}$${dk}`;
}

function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  try {
    const dk = crypto.scryptSync(String(plain), salt, 64).toString('hex');
    // timingSafeEqual throws on a length mismatch, which would itself leak information --
    // compare lengths first and fall through to a definite false.
    const a = Buffer.from(dk, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------- tokens ----------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
const sign = (data) => crypto.createHmac('sha256', SECRET()).update(data).digest('base64url');

function issueToken(user) {
  const payload = {
    sub: String(user.email).toLowerCase(),
    name: user.fullName,
    role: user.role,
    districtId: user.districtId || null,
    unitId: user.unitId || null,
    exp: Date.now() + TOKEN_TTL_HOURS * 3600 * 1000,
  };
  const body = b64(payload);
  return `${body}.${sign(body)}`;
}

// Returns the payload, or null. Never throws: a malformed token is an anonymous request, and
// the caller falls back to the demo path rather than 500ing.
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = sign(body);
  // Compare the signatures, not the tokens: same constant-time reasoning as above.
  const a = Buffer.from(mac);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = unb64(body); } catch { return null; }
  if (!payload || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// ---------- account lookup ----------
async function findAccount(req, email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return null;
  const seeded = provisioned().get(key);
  if (seeded) return { ...seeded, accountStatus: 'approved', source: 'provisioned' };

  // Signed-up accounts. Escaped rather than interpolated raw -- an email is user input and
  // reaches a query string.
  const safe = key.replace(/'/g, "''");
  const rows = await datastore.query(req,
    `SELECT ROWID, email, passwordHash, fullName, userRole, districtId, unitId, accountStatus `
      + `FROM ${TABLE} WHERE email = '${safe}'`, TABLE);
  if (!rows || !rows.length) return null;
  const r = rows[0];
  return {
    rowid: r.ROWID,
    email: r.email,
    passwordHash: r.passwordHash,
    fullName: r.fullName,
    role: r.userRole,
    districtId: r.districtId || null,
    unitId: r.unitId || null,
    accountStatus: r.accountStatus,
    source: 'signup',
  };
}

// ---------- operations ----------
async function login(req, email, plain) {
  await loadSecret(req);
  const acct = await findAccount(req, email);
  // One message for "no such account" and "wrong password". Distinguishing them turns the
  // login form into a directory of who holds an account.
  const refuse = { ok: false, error: 'Email or password is incorrect.' };
  if (!acct) return refuse;
  if (!verifyPassword(plain, acct.passwordHash)) return refuse;
  if (acct.accountStatus !== 'approved') {
    return {
      ok: false,
      error: acct.accountStatus === 'rejected'
        ? 'This request was declined. Contact the DGP office.'
        : 'This account is awaiting approval by the DGP or Administrator.',
      pending: acct.accountStatus === 'pending',
    };
  }
  return {
    ok: true,
    token: issueToken(acct),
    user: {
      email: acct.email, fullName: acct.fullName, role: acct.role,
      districtId: acct.districtId, unitId: acct.unitId,
    },
  };
}

const SIGNUP_ROLES = new Set(['Analyst', 'SP', 'DSP', 'SI', 'SHO']);

async function signup(req, { email, password, fullName, role, districtId, unitId }) {
  const key = String(email || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@ksp\.gov\.in$/.test(key)) {
    return { ok: false, error: `Use your official @${DOMAIN} address.` };
  }
  if (!fullName || String(fullName).trim().length < 3) return { ok: false, error: 'Enter your full name.' };
  if (!password || String(password).length < 10) {
    return { ok: false, error: 'Choose a password of at least 10 characters.' };
  }
  // DGP and Admin are not self-service. They approve others, so they cannot be requested.
  if (!SIGNUP_ROLES.has(role)) return { ok: false, error: 'Choose a valid post to request.' };
  if ((role === 'SP' || role === 'DSP') && !districtId) {
    return { ok: false, error: 'Select the district you serve.' };
  }

  if (await findAccount(req, key)) return { ok: false, error: 'An account already exists for this address.' };

  const row = {
    email: key,
    passwordHash: hashPassword(password),
    fullName: String(fullName).trim().slice(0, 128),
    userRole: role,
    districtId: districtId ? String(districtId) : '',
    unitId: unitId ? String(unitId) : '',
    // Pending is enforced at login, not merely displayed. An unapproved account is refused a
    // token, so there is nothing for the interface to get wrong.
    accountStatus: 'pending',
    requestedAt: new Date().toISOString(),
  };
  const wrote = await datastore.insertRows(req, TABLE, [row]);
  if (!wrote) return { ok: false, error: 'Could not record the request. Try again shortly.' };
  return { ok: true, pending: true };
}

async function listRequests(req, status = 'pending') {
  const safe = String(status).replace(/'/g, "''");
  const rows = await datastore.query(req,
    `SELECT ROWID, email, fullName, userRole, districtId, unitId, accountStatus, requestedAt, `
      + `approvedBy, decidedAt FROM ${TABLE} WHERE accountStatus = '${safe}'`, TABLE);
  if (!rows) return null;
  return rows.map((r) => ({
    id: r.ROWID, email: r.email, fullName: r.fullName, role: r.userRole,
    districtId: r.districtId || null, unitId: r.unitId || null,
    status: r.accountStatus, requestedAt: r.requestedAt,
    approvedBy: r.approvedBy || null, decidedAt: r.decidedAt || null,
  }));
}

async function decide(req, rowid, approve, deciderEmail) {
  const id = String(rowid).replace(/[^0-9]/g, '');
  if (!id) return { ok: false, error: 'Unknown request.' };
  const status = approve ? 'approved' : 'rejected';
  const by = String(deciderEmail || '').replace(/'/g, "''");
  const out = await datastore.query(req,
    `UPDATE ${TABLE} SET accountStatus='${status}', approvedBy='${by}', `
      + `decidedAt='${new Date().toISOString()}' WHERE ROWID=${id}`);
  if (out === null) return { ok: false, error: 'Could not record the decision.' };
  return { ok: true, status };
}

async function status(req) {
  await loadSecret(req);
  return {
    provisionedAccounts: provisioned().size,
    domain: DOMAIN,
    tokenTtlHours: TOKEN_TTL_HOURS,
    // Surfaced because an ephemeral secret means tokens die on every cold start, which
    // presents as random logouts. Better to read it than to diagnose it from behaviour.
    // The secret itself is never returned.
    secretSource,
    secretPersistent: secretSource === 'datastore',
  };
}

module.exports = {
  DOMAIN, login, signup, listRequests, decide, verifyToken, issueToken,
  hashPassword, verifyPassword, provisioned, status, loadSecret,
};
