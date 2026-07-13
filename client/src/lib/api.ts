// api.ts — typed fetch wrapper for the KADI API (envelope-aware, role header).
const BASE = (import.meta as any).env?.VITE_API_BASE || '/api';

export type Role = 'SI' | 'Inspector' | 'ACP' | 'Analyst' | 'Admin';

let currentRole: Role = (localStorage.getItem('kadi.role') as Role) || 'Analyst';
export function getRole(): Role { return currentRole; }
export function setRole(r: Role) { currentRole = r; localStorage.setItem('kadi.role', r); }

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
