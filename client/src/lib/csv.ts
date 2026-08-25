// CSV export for the register and watchlist views.
//
// An intelligence layer that cannot hand its output to the rest of the police workflow is a
// dead end -- a supervisor who filters down to "my station's ageing heinous cases" needs to
// take that list into a review meeting, not read it off a screen. So export follows the
// filter, not the page.

// Excel decides a field's type by looking at it, and a CrimeNo like 100010046202600104 is
// long enough that it renders as 1.0001E+17 -- which silently destroys the one column an
// officer would use to look the case back up. Quoting alone does not stop it; the leading
// tab does, and stays invisible in the cell.
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/^\d{12,}$/.test(s)) return `"\t${s}"`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: { key: string; label: string; get: (r: T) => unknown }[]): string {
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.get(r))).join(','));
  // BOM so Excel opens it as UTF-8 -- without it Kannada names and the ₹ sign arrive mangled.
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking immediately can cancel the download in Safari; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

// Collect a filtered result set for export, in the page size the API actually allows.
//
// Asking for ?pageSize=2000 does NOT return 2000 rows: the server hard-clamps page size to
// 200 so one request cannot pull the whole 60k corpus. A single big request therefore came
// back quietly truncated -- the file looked complete, was named after the filter, and held
// the first 200 of 2,340 matches. Walk the pages instead, and report honestly when the cap
// is hit rather than letting the file imply it holds everything.
const API_MAX_PAGE = 200;

export async function collectForExport<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
  cap: number,
): Promise<{ rows: T[]; total: number; truncated: boolean }> {
  const rows: T[] = [];
  let total = 0;
  for (let page = 1; rows.length < cap; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchPage(page, API_MAX_PAGE);
    total = res.total;
    rows.push(...res.items);
    if (res.items.length < API_MAX_PAGE || rows.length >= total) break;
  }
  return { rows: rows.slice(0, cap), total, truncated: total > cap };
}
