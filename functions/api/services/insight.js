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

async function generate(req, kind, facts, { maxTokens = 220 } = {}) {
  if (!quickml.configured()) return { text: fallback(kind, facts), source: 'deterministic' };
  try {
    const out = await quickml.complete(req, {
      system: SYSTEM,
      user: factsToPrompt(kind, facts),
      maxTokens,
      temperature: 0.35,
    });
    const text = (out || '').trim();
    if (!text) return { text: fallback(kind, facts), source: 'deterministic' };
    return { text, source: 'glm-4.7-flash' };
  } catch {
    return { text: fallback(kind, facts), source: 'deterministic' };
  }
}

module.exports = { generate, fallback, SYSTEM };
