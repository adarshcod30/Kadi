// Pull the user-facing strings out of the client so they can be translated once, at build
// time, into client/src/lib/kn.json.
//
// Runtime translation was the alternative and it is the wrong trade: a police officer toggling
// to Kannada should not wait on a model round trip per label, and a language that arrives
// progressively looks broken. Translating once and committing the result makes the toggle
// instant and reviewable -- someone can read the Kannada in a diff.
//
// The extractor is deliberately conservative. It takes JSX text nodes, placeholder/title/label
// attributes and a few known string props, then throws away anything that looks like data
// rather than interface: identifiers, class names, urls, code. A wrong string in the dictionary
// costs a mistranslated label; a missed one just stays English, so the filters lean strict.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'client', 'src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !/__tests__/.test(p)) files.push(p);
  }
})(SRC);

const found = new Map();          // text -> Set(files)
const add = (s, f) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!keep(t)) return;
  if (!found.has(t)) found.set(t, new Set());
  found.get(t).add(path.relative(SRC, f));
};

function keep(t) {
  if (t.length < 2 || t.length > 200) return false;
  if (!/[a-zA-Z]/.test(t)) return false;               // pure punctuation or numbers
  if (!/[aeiouAEIOU]/.test(t)) return false;           // class-name soup like "px-3 py-2"
  if (/^[a-z0-9-]+$/.test(t) && !/ /.test(t)) return false;  // single lowercase token: prop value
  if (/^(https?:|\/|#|data:|\.)/.test(t)) return false;
  if (/[{}<>$]/.test(t)) return false;                 // template or JSX fragment
  if (/\b(className|onClick|useState|const|return|import|export|function)\b/.test(t)) return false;
  if (/^[A-Z_]+$/.test(t)) return false;               // CONSTANT_NAME
  if (/(^| )(bg|text|border|flex|grid|rounded|px|py|mt|mb|ml|mr|gap|w|h)-/.test(t)) return false;
  // Code that survived the JSX text match: ternaries, optional chaining, member access,
  // logical operators, array-literal fragments. All of these read as prose to a naive regex.
  if (/\?\.|\.length|=>|&&|\|\||!==|===|\.\.\.|\\u00|\.map\(|\.filter\(/.test(t)) return false;
  if (/^[:,;?!)\]]/.test(t)) return false;              // starts mid-expression
  if (/', '|", "/.test(t)) return false;                // array literal
  if (/\b(data|props|state|item|items|rows|res|err)\b\s*[?.[]/.test(t)) return false;
  // Real interface copy starts with a letter or a currency/percent sign, not an operator.
  if (!/^[A-Za-z0-9\u0C80-\u0CFF(\u2014\u2013]/.test(t)) return false;
  // Ternary tails that begin with a bare number: "10 ? 'text-danger' : v".
  if (/^\d+\s*\?/.test(t)) return false;
  if (/'\s*:\s*'|'\s*:\s*[a-z]/.test(t)) return false;
  if (/\((path|body|req|res)\)|\bpost:|\bget:/.test(t)) return false;
  // Tailwind soup: several hyphenated tokens and no sentence punctuation.
  const words = t.split(' ');
  if (words.length > 2 && words.every((w) => /-/.test(w) || /^\d/.test(w))) return false;
  return true;
}

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // Strip comments so explanatory prose does not enter the dictionary.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // JSX text nodes: >text<
  for (const m of code.matchAll(/>([^<>{}\n][^<>{}]*)</g)) add(m[1], f);
  // String-valued props that reach the user
  for (const m of code.matchAll(/\b(placeholder|title|label|hint|aria-label|alt)\s*=\s*"([^"]{2,200})"/g)) add(m[2], f);
  // tx('...') calls. These are inside JSX braces so the text-node pattern above cannot see
  // them, and they are the MOST certain user-facing strings in the file -- someone marked
  // them for translation by hand.
  for (const m of code.matchAll(/\btx\(\s*'((?:[^'\\]|\\.)*)'/g)) add(m[1].replace(/\\'/g, "'"), f);
  for (const m of code.matchAll(/\btx\(\s*"((?:[^"\\]|\\.)*)"/g)) add(m[1], f);
  // Quoted strings assigned to obviously user-facing names
  for (const m of code.matchAll(/\b(label|title|hint|text|heading|caption|message|reason|note|placeholder)\s*:\s*'([^']{2,200})'/g)) add(m[2], f);
}

const out = [...found.entries()]
  .map(([text, fs_]) => ({ text, files: [...fs_].sort() }))
  .sort((a, b) => a.text.localeCompare(b.text));

const dest = path.join(__dirname, '..', 'client', 'src', 'lib', 'ui-strings.json');
fs.writeFileSync(dest, JSON.stringify(out.map((o) => o.text), null, 0));
console.log(`${out.length} strings from ${files.length} files -> ${path.relative(process.cwd(), dest)}`);
console.log(`chars: ${out.reduce((n, o) => n + o.text.length, 0).toLocaleString()}`);
console.log('\nsample:');
for (const o of out.slice(0, 12)) console.log(`  ${JSON.stringify(o.text).slice(0, 90)}`);
