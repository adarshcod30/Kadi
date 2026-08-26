// api.ts — typed fetch wrapper for the KADI API (envelope-aware, role header).
const BASE = (import.meta as any).env?.VITE_API_BASE || '/api';
// Exported for the one caller that cannot go through api.get/post: the assistant fetches
// audio/wav bytes from /tts, and those helpers parse JSON.
export const API_BASE = BASE;

// Two tiers. State: Analyst, DGP, Admin. District: SP, DSP, SI.
export type Role = 'Analyst' | 'DGP' | 'Admin' | 'SP' | 'DSP' | 'SI' | 'SHO';
export const STATE_ROLES: Role[] = ['Analyst', 'DGP', 'Admin'];
export const DISTRICT_ROLES: Role[] = ['SP', 'DSP', 'SI'];
// The station tier: one register, no drill-out. See rbac.js for why only one is provisioned.
export const STATION_ROLES: Role[] = ['SHO'];
export const isStateTier = (r: Role) => STATE_ROLES.includes(r);
// Older saved sessions and shared links still carry the previous names.
const LEGACY: Record<string, Role> = { Inspector: 'SI', ACP: 'DSP', SCRB: 'Analyst' };
export const normaliseRole = (r: string | null): Role =>
  (['Analyst','DGP','Admin','SP','DSP','SI','SHO'].includes(r || '') ? r : LEGACY[r || ''] || 'Analyst') as Role;

// Read defensively. This runs at module scope, so anything that imports the API layer
// without a browser storage implementation -- tests, SSR, some privacy modes -- crashed on
// import rather than degrading. Falling back to the default role is always safe: the server
// re-derives scope from the header on every request and never trusts the client.
function readStoredRole(): Role {
  try {
    return normaliseRole(globalThis.localStorage?.getItem('kadi.role') ?? null);
  } catch {
    return 'Analyst';
  }
}
let currentRole: Role = readStoredRole();
export function getRole(): Role { return currentRole; }

// Scope lives in the URL so it survives a reload and can be shared. Every request carries it,
// because the server re-derives scope per request and holds no session.
export function districtParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('district');
  } catch { return null; }
}
export function setRole(r: Role) {
  currentRole = r;
  try { globalThis.localStorage?.setItem('kadi.role', r); } catch { /* storage unavailable */ }
}

// ---- session token -------------------------------------------------------------------
// A signed-in session carries a bearer token; the demo path carries only the role header.
// Both are sent, and the SERVER decides: when a valid token is present it ignores the header
// entirely, so a demo role cannot be used to widen a real account's scope.
const TOKEN_KEY = 'kadi.token';
export function getToken(): string | null {
  try { return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null; } catch { return null; }
}
export function setToken(t: string | null) {
  try {
    if (t) globalThis.localStorage?.setItem(TOKEN_KEY, t);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}
export function signOut() {
  setToken(null);
  try { globalThis.localStorage?.removeItem('kadi.role'); } catch { /* ignore */ }
  // currentRole is read from storage once, at import. Clearing storage alone left the old
  // role in memory and every subsequent request still carried it -- which is why the login
  // page kept showing the previous session's station-scoped figures after signing out.
  currentRole = 'Analyst';
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  // Carry the drilled district on every call. The server holds no session and re-derives
  // scope from each request, so a scope that lived only in the URL bar would be ignored by
  // every fetch the page makes.
  const d = districtParam();
  let url = `${BASE}${path}`;
  if (d && !/[?&]district=/.test(url)) url += `${url.includes('?') ? '&' : '?'}district=${encodeURIComponent(d)}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-kadi-role': currentRole,
      // x-kadi-token, not Authorization: Catalyst's gateway intercepts the latter as its
      // own OAuth credential and rejects the request before the function runs.
      ...(getToken() ? { 'x-kadi-token': getToken() as string } : {}),
      ...(opts.headers || {}),
    },
  });
  // An expired or revoked token must return the user to the door rather than leaving them in
  // a shell whose every request 401s. Only bounce when a token was actually presented --
  // otherwise a demo session would be ejected by any unrelated 401.
  if (res.status === 401 && getToken() && !path.startsWith('/auth/')) {
    signOut();
    if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/login')) {
      window.location.href = '/app/login';
    }
  }
  const body = await res.json().catch(() => ({ ok: false, error: { code: 'bad_json', message: 'Invalid response' } }));
  if (!body.ok) throw new ApiError(body.error?.code || 'error', body.error?.message || 'Request failed');
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
};

export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// Page-size and page come out of the URL, which anyone can hand-edit or share. A junk value
// must fall back, not render an empty table with a nonsensical "1-0 of 578" readout: these
// views are explicitly shareable, so a malformed link is a normal input, not an edge case.
export function clampPageSize(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(200, Math.floor(n)) : fallback;
}
export function clampPage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
