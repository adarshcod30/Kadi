// Translate the extracted UI strings once and commit the result as client/src/lib/kn.json.
//
// Committed rather than fetched at runtime for two reasons. An officer switching to Kannada
// should not wait on a model round trip per label, and a translation that lands in a repo can
// be read in a diff and corrected by someone who speaks the language -- a runtime one cannot.
//
// Re-run after adding interface copy. Existing entries are kept, so a correction made by hand
// in kn.json survives the next run: only strings with no translation yet are sent.
const fs = require('fs');
const path = require('path');
const https = require('https');

const API = process.env.KADI_API
  || 'https://kadilabs-60078029367.development.catalystserverless.in/server/api';
const LIB = path.join(__dirname, '..', 'client', 'src', 'lib');
const SRC = path.join(LIB, 'ui-strings.json');
const DEST = path.join(LIB, 'kn.json');
const BATCH = 25;

function post(texts) {
  return new Promise((resolve) => {
    const url = new URL(`${API}/translate`);
    const body = JSON.stringify({ to: 'kn', texts });
    const rq = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000,
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(out);
          resolve(j.ok && j.data ? j.data : null);
        } catch { resolve(null); }
      });
    });
    rq.on('timeout', () => { rq.destroy(); resolve(null); });
    rq.on('error', () => resolve(null));
    rq.write(body); rq.end();
  });
}

(async () => {
  const strings = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  let dict = {};
  if (fs.existsSync(DEST)) dict = JSON.parse(fs.readFileSync(DEST, 'utf8'));
  const todo = strings.filter((s) => !dict[s]);
  console.log(`${strings.length} strings, ${strings.length - todo.length} already translated, ${todo.length} to do`);

  let done = 0; let failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const out = await post(batch);
    if (!out || !out.items) { failed += batch.length; console.log(`  batch ${i / BATCH + 1}: FAILED`); continue; }
    for (const it of out.items) {
      // Only keep a real translation. Storing the English back would make the dictionary look
      // complete while the interface stayed in English, which is the worst of both.
      if (it.translated && it.text && it.text !== it.source) dict[it.source] = it.text;
      else failed += 1;
    }
    done += batch.length;
    fs.writeFileSync(DEST, JSON.stringify(dict, null, 1));
    console.log(`  ${done}/${todo.length} (${out.engine})`);
  }
  const keys = Object.keys(dict).length;
  console.log(`\n${keys} entries -> ${path.relative(process.cwd(), DEST)}  (${failed} untranslated)`);
})();
