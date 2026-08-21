// The role model is the thing that was silently wrong for longest: five roles collapsed to
// two tiers, legacy names still arriving from saved links, and a period where the tiers were
// enforced server-side but invisible in the UI. These lock the contract down.
import { describe, it, expect } from 'vitest';
import { normaliseRole, isStateTier, STATE_ROLES, DISTRICT_ROLES } from '../lib/api';

describe('role model', () => {
  it('has exactly two tiers covering every role', () => {
    expect(STATE_ROLES).toEqual(['Analyst', 'DGP', 'Admin']);
    expect(DISTRICT_ROLES).toEqual(['SP', 'DSP', 'SI']);
    expect(new Set([...STATE_ROLES, ...DISTRICT_ROLES]).size).toBe(6);
  });

  it('separates state tier from district tier', () => {
    for (const r of STATE_ROLES) expect(isStateTier(r)).toBe(true);
    for (const r of DISTRICT_ROLES) expect(isStateTier(r)).toBe(false);
  });

  it('maps legacy role names rather than dropping them', () => {
    // Saved links and cached sessions still carry these; the ?as= examples in the README do too.
    expect(normaliseRole('Inspector')).toBe('SI');
    expect(normaliseRole('ACP')).toBe('DSP');
    expect(normaliseRole('SCRB')).toBe('Analyst');
  });

  it('falls back to Analyst for anything unrecognised', () => {
    expect(normaliseRole(null)).toBe('Analyst');
    expect(normaliseRole('')).toBe('Analyst');
    expect(normaliseRole('Wizard')).toBe('Analyst');
  });

  it('passes current roles through untouched', () => {
    for (const r of [...STATE_ROLES, ...DISTRICT_ROLES]) expect(normaliseRole(r)).toBe(r);
  });
});
