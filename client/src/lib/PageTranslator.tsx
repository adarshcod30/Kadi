// PageTranslator — turns the whole interface over to Kannada, not just the parts someone
// remembered to wrap.
//
// WHY THIS AND NOT A KEY PER STRING. The interface holds around 570 distinct sentences across
// 38 files. Wrapping each one at its call site is the textbook answer and it has a failure mode
// that matters here: whoever adds the 571st forgets, and the language toggle quietly becomes
// "most things translate". That is exactly the complaint this replaces. Walking the rendered
// text instead means coverage does not depend on anyone remembering.
//
// WHAT MUST NEVER BE TRANSLATED, and why this is the whole design.
//
// An FIR number rendered in Kannada numerals is a corrupted record. A district id, a case id,
// a person's name, a coordinate, a percentage - every one of these is DATA, and a police
// officer searching for 100010064202600888 must find it whatever language the chrome is in.
// So the walker refuses to touch:
//
//   * anything inside [data-notranslate], .font-mono or .font-num - the classes this codebase
//     already uses for identifiers and figures
//   * <code>, <pre>, <script>, <style>, <svg>, and form controls
//   * any string without a letter, or that is mostly digits
//   * anything that looks like an identifier, a date, a URL or an email
//
// The exclusions are deliberately over-broad. Leaving a label in English costs nothing;
// translating an FIR number costs an officer the case.
//
// Originals are kept on the node, so switching back to English restores exactly what React
// rendered rather than a translation of a translation. A MutationObserver re-runs after React
// repaints, because React owns the DOM and will overwrite anything written underneath it.
import { useEffect } from 'react';
import { useLang, tx, reverseKn } from './i18n';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'SVG', 'PATH', 'CANVAS',
  'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
]);
const SKIP_SELECTOR = '[data-notranslate], .font-mono, .font-num, code, pre, svg';

// Kept per text node: what React last put there, and what we last wrote. If the node's current
// text is neither, React has re-rendered it with something new and it needs translating again.
const seen = new WeakMap<Text, { source: string; rendered: string }>();

function isData(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return true;
  if (!/[a-zA-Z]/.test(t)) return true;                       // digits, punctuation, symbols
  if (/^[\d\s.,:%/₹+-]+$/.test(t)) return true;               // figures
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(t)) return true;          // dates
  if (/^\d[\d.,]*\s*(%|d|km|m)$/i.test(t)) return true;       // 12.5%, 762d
  if (/^https?:|^\/|@|\.(com|in|gov|org)\b/.test(t)) return true;
  if (/^[A-Z0-9_-]{6,}$/.test(t)) return true;                // bare identifier
  if (/^\d{6,}$/.test(t)) return true;                        // crime number
  if (/^LIVE-/.test(t)) return true;                          // live case id
  // A district or crime-head NAME is data too -- it comes from the corpus, not the interface,
  // and translating "Bengaluru City" into Kannada script in one place and not another makes
  // the same district look like two.
  return false;
}

function shouldSkip(node: Text): boolean {
  const p = node.parentElement;
  if (!p) return true;
  if (SKIP_TAGS.has(p.tagName)) return true;
  if (p.closest(SKIP_SELECTOR)) return true;
  if (p.isContentEditable) return true;
  return false;
}

// Attributes that reach the reader but are not text nodes: a placeholder, a tooltip, a screen
// reader label. The walker cannot see them, and leaving them English is exactly the
// "only some things translate" complaint -- the search box is the first thing on the page.
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const attrSeen = new WeakMap<Element, Record<string, { source: string; rendered: string }>>();

function walkAttrs(root: ParentNode, apply: (el: Element, attr: string) => void) {
  const els = root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','));
  els.forEach((el) => {
    if (el.closest(SKIP_SELECTOR)) return;
    ATTRS.forEach((a) => { if (el.hasAttribute(a)) apply(el, a); });
  });
}

function walk(root: Node, apply: (n: Text) => void) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const t = n as Text;
      if (!t.nodeValue || !t.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (shouldSkip(t)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const batch: Text[] = [];
  for (let n = it.nextNode(); n; n = it.nextNode()) batch.push(n as Text);
  batch.forEach(apply);
}

export function PageTranslator() {
  const { lang } = useLang();

  useEffect(() => {
    const root = document.getElementById('root') || document.body;

    if (lang !== 'kn') {
      // Restore, in two passes.
      //
      // The first is the bookkeeping: nodes we changed and nothing has touched since. It is
      // correct where it applies and it does not apply often enough -- React recreates text
      // nodes as it re-renders, which breaks a WeakMap keyed on node identity, and the symptom
      // is a page that goes to Kannada and comes back 59% of the way. Measured, not guessed.
      //
      // The second pass needs no memory: any node whose text IS a known Kannada translation is
      // put back to its English, whoever wrote it. That covers the nodes React re-rendered,
      // the ones tx() produced directly inside a component, and anything a future change adds
      // without telling this file.
      const back = reverseKn();
      walk(root, (n) => {
        const rec = seen.get(n);
        if (rec && n.nodeValue === rec.rendered) { n.nodeValue = rec.source; return; }
        const cur = n.nodeValue || '';
        const core = cur.trim();
        if (!core) return;
        const en = back[core];
        if (en) n.nodeValue = cur.replace(core, en);
      });
      walkAttrs(root as ParentNode, (el, a) => {
        const rec = attrSeen.get(el)?.[a];
        if (rec && el.getAttribute(a) === rec.rendered) { el.setAttribute(a, rec.source); return; }
        const cur = (el.getAttribute(a) || '').trim();
        const en = cur && back[cur];
        if (en) el.setAttribute(a, en);
      });
      return undefined;
    }

    let queued = false;
    const run = () => {
      queued = false;
      observer.disconnect();
      walk(root, (n) => {
        const current = n.nodeValue || '';
        const rec = seen.get(n);
        // Already ours and untouched since -- nothing to do.
        if (rec && current === rec.rendered) return;
        const source = rec && current === rec.rendered ? rec.source : current;
        if (isData(source)) return;
        // Preserve the exact leading and trailing whitespace: JSX uses it for spacing between
        // inline elements, and eating it runs words together.
        const lead = source.match(/^\s*/)?.[0] ?? '';
        const trail = source.match(/\s*$/)?.[0] ?? '';
        const core = source.trim();
        const out = tx(core, 'kn');
        if (out === core) return;                    // no translation yet; leave English
        const rendered = `${lead}${out}${trail}`;
        n.nodeValue = rendered;
        seen.set(n, { source, rendered });
      });
      walkAttrs(root as ParentNode, (el, a) => {
        const current = el.getAttribute(a) || '';
        const prev = attrSeen.get(el)?.[a];
        if (prev && current === prev.rendered) return;
        if (isData(current)) return;
        const out = tx(current.trim(), 'kn');
        if (out === current.trim()) return;
        el.setAttribute(a, out);
        const bag = attrSeen.get(el) || {};
        bag[a] = { source: current, rendered: out };
        attrSeen.set(el, bag);
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      // One frame plus a beat: React commits, then we translate what it committed.
      setTimeout(run, 60);
    };
    const observer = new MutationObserver(schedule);

    schedule();
    // tx() resolves unknown strings asynchronously through /translate. When a batch lands the
    // dictionary has grown, so sweep again -- otherwise the first render of a new page stays
    // English until something else happens to mutate the DOM.
    const poll = setInterval(schedule, 1200);

    return () => {
      observer.disconnect();
      clearInterval(poll);
    };
  }, [lang]);

  return null;
}
