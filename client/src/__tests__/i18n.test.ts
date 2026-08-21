// A half-translated page reads worse than an untranslated one. This catches the case where
// an English string is added and the Kannada side is forgotten.
import { describe, it, expect } from 'vitest';
import { DICT } from '../lib/i18n';

describe('i18n', () => {
  const entries = Object.entries(DICT as Record<string, { en: string; kn: string }>);

  it('has translations either side for every key', () => {
    const missing = entries.filter(([, v]) => !v.en?.trim() || !v.kn?.trim()).map(([k]) => k);
    expect(missing).toEqual([]);
  });

  it('does not leave Kannada as a copy of the English', () => {
    // A few keys are legitimately identical (proper nouns, "KADI"); flag only the bulk case.
    const same = entries.filter(([, v]) => v.en === v.kn);
    expect(same.length).toBeLessThan(entries.length * 0.2);
  });
});
