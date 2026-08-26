#!/usr/bin/env node
// Generates the 36 provisioned KADI accounts.
//
// Writes two artefacts from one source of truth, so they can never drift:
//   functions/api/data/accounts.json   hashes only — deployed with the function
//   docs/ACCESS_CREDENTIALS.md         the readable list, for evaluating the build
//
// Passwords are random per account and hashed with scrypt before anything is written to the
// app. The app itself never holds a plaintext password: it derives a hash from what is typed
// and compares. The readable list exists because these accounts guard a synthetic corpus and
// an evaluator has to be able to check the access model is real rather than take it on trust.
//
// Re-running this REGENERATES every password. Do not run it casually once the credential list
// has been shared -- the old list stops working the moment the new hashes deploy.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DOMAIN = 'ksp.gov.in';
const ROOT = path.join(__dirname, '..');

// Mirrors rbac.js. Duplicated deliberately: this script must run without loading the corpus.
const DISTRICTS = {
  1: 'Bengaluru City', 2: 'Bengaluru Rural', 3: 'Mysuru', 4: 'Mandya', 5: 'Hassan',
  6: 'Tumakuru', 7: 'Kalaburagi', 8: 'Ballari', 9: 'Vijayapura', 10: 'Belagavi',
  11: 'Dharwad', 12: 'Hubballi-Dharwad', 13: 'Udupi', 14: 'Dakshina Kannada',
  15: 'Uttara Kannada', 16: 'Shivamogga', 17: 'Chitradurga', 18: 'Davanagere',
  19: 'Kolar', 20: 'Chikkaballapura', 21: 'Ramanagara', 22: 'Chamarajanagar',
  23: 'Kodagu', 24: 'Chikkamagaluru', 25: 'Haveri', 26: 'Gadag', 27: 'Bagalkote',
  28: 'Koppal', 29: 'Raichur', 30: 'Yadgir', 31: 'Bidar',
};
const STATION_UNIT_ID = '46';
const STATION_NAME = 'Bengaluru Bazaar PS';
const STATION_DISTRICT = '1';

// Readable but not guessable. Ambiguous glyphs are dropped so a password can be copied off a
// screen without the 0/O and 1/l confusion that makes people think auth is broken.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function password(len = 14) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// scrypt with a per-account salt. N=16384 is the Node default work factor -- slow enough to
// make offline guessing expensive, fast enough to stay inside the 30s function budget.
function hash(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${dk}`;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const accounts = [];
const add = (email, fullName, role, districtId, unitId, note) => {
  const plain = password();
  accounts.push({
    email: `${email}@${DOMAIN}`.toLowerCase(),
    fullName, role, districtId: districtId || null, unitId: unitId || null,
    plain, passwordHash: hash(plain), note,
  });
};

// --- state tier: the whole of Karnataka ---
add('dgp', 'DGP Karnataka', 'DGP', null, null, 'All 31 districts. Approves sign-up requests.');
add('scrb.analyst', 'SCRB Analyst', 'Analyst', null, null, 'All 31 districts, analytics and forecasting.');
add('admin', 'System Administrator', 'Admin', null, null, 'State tier plus audit and fairness. Approves sign-ups.');

// --- district tier: one SP per district, locked to that district ---
for (const [id, name] of Object.entries(DISTRICTS)) {
  add(`sp.${slug(name)}`, `SP ${name}`, 'SP', String(id), null, `${name} only. Cannot read another district.`);
}

// --- station tier: one register, two posts ---
add('sho.bengalurubazaar', `SHO ${STATION_NAME}`, 'SHO', STATION_DISTRICT, STATION_UNIT_ID,
  `${STATION_NAME} only.`);
add('si.bengalurubazaar', `PSI ${STATION_NAME}`, 'SI', STATION_DISTRICT, STATION_UNIT_ID,
  `${STATION_NAME} only.`);

// --- write the deployed artefact: hashes, never plaintext ---
const bundle = {
  generatedAt: new Date().toISOString(),
  domain: DOMAIN,
  note: 'Provisioned accounts. Password hashes only - the plaintext lives in docs/ACCESS_CREDENTIALS.md.',
  accounts: accounts.map(({ plain, note, ...rest }) => rest),
};
const outJson = path.join(ROOT, 'functions/api/data/accounts.json');
fs.writeFileSync(outJson, `${JSON.stringify(bundle, null, 2)}\n`);

// --- write the readable list ---
const byTier = {
  State: accounts.filter((a) => ['DGP', 'Analyst', 'Admin'].includes(a.role)),
  District: accounts.filter((a) => a.role === 'SP'),
  Station: accounts.filter((a) => ['SHO', 'SI'].includes(a.role)),
};
const lines = [
  '# KADI — provisioned access',
  '',
  '> **These accounts guard a synthetic corpus.** Every FIR, offender and address in KADI is',
  '> generated data. No account here reaches a real police record, and none of these passwords',
  '> is reused from any real system. They are published so the access model can be checked',
  '> rather than believed: sign in as SP Mysuru and confirm for yourself that Bengaluru City',
  '> is genuinely unreachable, not merely hidden.',
  '',
  `All addresses are on \`@${DOMAIN}\`. Sign-in is at \`/app/login\`.`,
  '',
  '## How scope works',
  '',
  '| Tier | What the account reads | Can it switch? |',
  '|---|---|---|',
  '| State | All 31 districts | Yes — may drill into any district and back out |',
  '| District | Exactly one district, plus cases linked into it | No — pinned to its own district |',
  '| Station | Exactly one station register | No — pinned to its own station |',
  '',
  'Scope is enforced server-side on every query. Editing the URL does not widen it.',
  '',
];
for (const [tier, list] of Object.entries(byTier)) {
  lines.push(`## ${tier} tier`, '', '| Email | Password | Post | Reads |', '|---|---|---|---|');
  for (const a of list) lines.push(`| \`${a.email}\` | \`${a.plain}\` | ${a.fullName} | ${a.note} |`);
  lines.push('');
}
lines.push(
  '## Signing up',
  '',
  `New officers register at \`/app/login\` with an \`@${DOMAIN}\` address and request a tier.`,
  'The account is created **pending** and cannot sign in until the DGP or the Administrator',
  'approves it from Admin → Access requests. This is the approval chain, not a formality:',
  'a pending account is refused at the login endpoint, not merely hidden in the interface.',
  '',
  '## Demo access',
  '',
  'The three tier cards on the sign-in page enter without credentials, for evaluation. The',
  'demo district tier may switch freely between districts; a real SP account cannot. That',
  'difference is the point of having both.',
  '',
  '---',
  '',
  `Generated by \`scripts/seed_accounts.js\` on ${new Date().toISOString().slice(0, 10)}.`,
  'Re-running it regenerates every password and invalidates this list.',
  '',
);
const outMd = path.join(ROOT, 'docs/ACCESS_CREDENTIALS.md');
fs.writeFileSync(outMd, lines.join('\n'));

console.log(`wrote ${accounts.length} accounts`);
console.log(`  ${path.relative(ROOT, outJson)}  (hashes only)`);
console.log(`  ${path.relative(ROOT, outMd)}  (readable list)`);
for (const [tier, list] of Object.entries(byTier)) console.log(`  ${tier}: ${list.length}`);
