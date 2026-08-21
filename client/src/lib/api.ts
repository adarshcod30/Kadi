// api.ts — typed fetch wrapper for the KADI API (envelope-aware, role header).
const BASE = (import.meta as any).env?.VITE_API_BASE || '/api';

// Two tiers. State: Analyst, DGP, Admin. District: SP, DSP, SI.
export type Role = 'Analyst' | 'DGP' | 'Admin' | 'SP' | 'DSP' | 'SI';
export const STATE_ROLES: Role[] = ['Analyst', 'DGP', 'Admin'];
export const DISTRICT_ROLES: Role[] = ['SP', 'DSP', 'SI'];
export const isStateTier = (r: Role) => STATE_ROLES.includes(r);
// Older saved sessions and shared links still carry the previous names.
const LEGACY: Record<string, Role> = { Inspector: 'SI', ACP: 'DSP', SCRB: 'Analyst' };
export const normaliseRole = (r: string | null): Role =>
  (['Analyst','DGP','Admin','SP','DSP','SI'].includes(r || '') ? r : LEGACY[r || ''] || 'Analyst') as Role;

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
export function setRole(r: Role) {
  currentRole = r;
  try { globalThis.localStorage?.setItem('kadi.role', r); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-kadi-role': currentRole,
      ...(opts.headers || {}),
    },
  });
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
