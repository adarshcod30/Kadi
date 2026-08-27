// tiers.ts — the one place the three role tiers and the three zone bands are described.
//
// D1 made the tier colours load-bearing: blue = state (strategic), saffron = district
// (tactical), teal = station (operational). Every scope-differentiated panel reads its label
// and colour from here so the product speaks one visual language about who a screen is for.
//
// D3 collapsed the zone vocabulary to three bands. `red` is gone; the keys the server still
// emits (red_pulsing / yellow / normal) map to the display names Pulsing / Watch / Normal.
// Keeping the server keys avoids a rename across every switch statement; only the display
// changed.

export type Tier = 'state' | 'district' | 'station';

export const TIER: Record<Tier, { label: string; short: string; color: string; soft: string }> = {
  state: { label: 'State', short: 'Strategic', color: '#1A6FC4', soft: '#EAF3FB' },
  district: { label: 'District', short: 'Tactical', color: '#E8871E', soft: '#FDF1E4' },
  station: { label: 'Station', short: 'Operational', color: '#2FA8A0', soft: '#E4F4F3' },
};

// Effective tier from a /me capabilities object (drill-aware): a state user who has drilled
// into a district is showing district-shaped panels, so it reads as district here.
export function tierOf(cap: any): Tier {
  const s = cap?.effectiveScope || cap?.scope;
  if (s === 'unit') return 'station';
  if (s === 'district') return 'district';
  return 'state';
}

// Three bands, in severity order. `label` is what the reader sees; the keys match the server.
export const BAND: Record<string, { label: string; dot: string; text: string; pulse?: boolean; rank: number }> = {
  red_pulsing: { label: 'Pulsing', dot: '#C0392B', text: '#C0392B', pulse: true, rank: 0 },
  yellow: { label: 'Watch', dot: '#C9820A', text: '#C9820A', rank: 1 },
  normal: { label: 'Normal', dot: '#3AA76D', text: '#3AA76D', rank: 2 },
};
// Anything unrecognised (an old `red` from a stale cache) degrades to Watch rather than vanishing.
export function band(zone?: string) { return BAND[zone || 'normal'] || BAND.yellow; }
export const BAND_ORDER = ['red_pulsing', 'yellow', 'normal'] as const;

// The statutory-deadline bands (D4), separate from health severity.
export const DEADLINE: Record<string, { label: string; dot: string; text: string }> = {
  breached: { label: 'Breached', dot: '#C0392B', text: '#C0392B' },
  critical: { label: '≤ 7 days', dot: '#C0392B', text: '#C0392B' },
  soon: { label: '≤ 21 days', dot: '#C9820A', text: '#C9820A' },
  ok: { label: 'On track', dot: '#3AA76D', text: '#3AA76D' },
};
