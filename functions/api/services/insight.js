// insight.js — the narrative layer.
//
// The brief's central complaint about the status quo is "a notable absence of AI-driven
// approaches", and it asks for analysis that moves "beyond static charts into dynamic,
// spatial and relational storytelling". This is that layer.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: the model never produces a fact.
//
// Every number, district name, FIR reference and percentage is computed by the deterministic
// pipeline and passed in. GLM receives those facts and returns prose. It is not asked what
// is true, only how to say it. That preserves the property worth more than fluency here --
// every figure on screen traces back to a row -- and it is the answer to the only question
// that really threatens an AI tool in policing: how do you know it isn't making this up?
//
// Insights are generated in the nightly Job and cached into the read-model, not per request.
// A 30-second request cap and a token bill both argue for that.
const quickml = require('./quickml');

const SYSTEM = [
  'You are a crime analyst writing for senior police officers in Karnataka.',
  'You will be given FACTS computed from the case database. Write 2-3 short sentences',
  'interpreting them for an officer deciding where to put attention.',
  'RULES:',
  '- Use ONLY the numbers given, COPIED EXACTLY as written. Do not reformat, round,',
  '  re-punctuate or recompute them. If a fact says "256", write 256 -- never 2,56.',
  '- Never invent a figure, district, station or FIR number.',
  '- No preamble, no "based on the data", no bullet points. Plain prose.',
  '- Lead with what changed or what stands out, then what it implies operationally.',
  '- Be specific and calm. No alarmism, no filler adjectives.',
  '- British English. Never mention caste, religion or occupation.',
].join(' ');

// Numbers are pre-rendered as strings before the model ever sees them. Handing GLM a raw
// integer invites it to re-punctuate: asked to summarise 256 it produced "2,56". Giving it
// "256" as text means the only correct action is to copy the characters.
function humanise(v) {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toLocaleString('en-IN') : String(v);
  }
  if (Array.isArray(v)) return v.map(humanise);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, humanise(x)]));
  }
  return v;
}

function factsToPrompt(kind, facts) {
  return `Context: ${kind}\n\nFACTS (copy every number exactly as written):\n`
    + `${JSON.stringify(humanise(facts), null, 2)}\n\nWrite the interpretation.`;
}

// Deterministic fallback so every surface has copy even when the model is unavailable.
// Reads as a summary rather than an apology -- a missing LLM should degrade the prose,
// never leave an empty panel.
function fallback(kind, facts) {
  const bits = Object.entries(facts || {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} ${v}`);
  return bits.length ? `${kind}: ${bits.join(', ')}.` : '';
}

// `fallbackText` lets a caller supply its own deterministic sentence. The generic fallback
// below flattens facts into "kind: key value, key value." -- serviceable for a band of
// findings, unreadable as a headline paragraph. A surface that can phrase its own numbers
// should, and then the model is an improvement on the floor rather than the only thing
// standing between the reader and a key-value dump.
async function generate(req, kind, facts, { maxTokens = 220, system = SYSTEM, fallbackText = null } = {}) {
  const floor = () => ({ text: fallbackText || fallback(kind, facts), source: 'deterministic' });
  if (!quickml.configured()) return floor();
  try {
    const out = await quickml.complete(req, {
      system,
      user: factsToPrompt(kind, facts),
      maxTokens,
      temperature: 0.35,
    });
    const text = (out || '').trim();
    if (!text) return floor();
    return { text, source: 'glm-4.7-flash' };
  } catch {
    return floor();
  }
}

// Contract for the contextual intelligence bands.
//
// The generic prompt failed here in ways worth recording, because each one is a different
// species of error and only the first is the obvious one:
//
//  1. It spelled figures out ("Seventy-five point four percent"), so percentages are handed
//     over pre-formatted and it is told they are already final.
//  2. It restated one finding twice in three sentences, so repetition is banned outright.
//  3. It opened on the blandest item and skipped a 6.7x over-representation, so it is told
//     the list arrives ranked and the first entry leads.
//  4. THE DANGEROUS ONE: it copied every digit correctly and then invented the relationships
//     between them -- "74 offenders active across districts" became "74 of the currently
//     active cases", a hotspot holding 70 cases became "Bengaluru City accounts for 70% of
//     hotspot cases", and a linkage rate became evidence of "repeat offending" when links
//     also come from MO, place, time and section. No individual number was wrong; every
//     claim was. Copying facts is not the same as preserving them, so the rules below forbid
//     combining figures across findings, deriving new ones, and drawing conclusions the
//     finding text does not already state.
const SIGNALS_SYSTEM = [
  'You are a crime analyst briefing a senior police officer in Karnataka.',
  'You are given FINDINGS already computed from the case records, ranked most important first.',
  'Write 2-3 sentences that present them as one short brief.',
  'RULES:',
  '- Copy every figure EXACTLY as written, including its % sign and its unit.',
  '  Never spell a number out in words: write 75.4%, never "seventy-five point four percent".',
  '- Each finding is INDEPENDENT. Never combine figures from two findings into one claim,',
  '  and never present one finding as a subset, cause or consequence of another.',
  '- Never compute, derive or estimate a new number. If a figure is a count, it stays a count:',
  '  do not convert it into a percentage or a share of anything.',
  '- Carry each number with the exact noun it was given with. A count of offenders is not a',
  '  count of cases; a count of cases in a cluster is not a share of a district.',
  '- State only what the finding already says. Do not add an explanation for WHY it is so.',
  '- Never state the same finding twice. Each sentence must add something new.',
  '- Lead with the FIRST finding; it is the most significant.',
  '- Never invent a figure, district, station, offender or FIR number.',
  '- No preamble, no bullet points, no "the data shows". Plain prose, British English.',
  '- Never mention caste, religion or occupation.',
].join(' ');

module.exports = { generate, fallback, SYSTEM, SIGNALS_SYSTEM };
