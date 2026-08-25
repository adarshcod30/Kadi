import { describe, it, expect } from 'vitest';
import { toCsv } from '../lib/csv';
import { clampPage, clampPageSize } from '../lib/api';

type Row = { crimeNo: string; name: string; n: number; note: string | null };
const cols = [
  { key: 'crimeNo', label: 'CrimeNo', get: (r: Row) => r.crimeNo },
  { key: 'name', label: 'Offender', get: (r: Row) => r.name },
  { key: 'n', label: 'Cases', get: (r: Row) => r.n },
  { key: 'note', label: 'Note', get: (r: Row) => r.note },
];

describe('csv export', () => {
  it('keeps a long CrimeNo out of scientific notation', () => {
    // 100010046202600104 is 18 digits. Unquoted, Excel renders it 1.0001E+17 and the officer
    // loses the one field they would use to look the case back up.
    const csv = toCsv([{ crimeNo: '100010046202600104', name: 'A', n: 1, note: null }], cols);
    expect(csv).toContain('"\t100010046202600104"');
  });

  it('escapes commas, quotes and newlines rather than shifting columns', () => {
    const csv = toCsv([{ crimeNo: '1', name: 'Rao, S', n: 2, note: 'said "no"\nthen left' }], cols);
    expect(csv).toContain('"Rao, S"');
    expect(csv).toContain('"said ""no""\nthen left"');
    // Records are delimited by \r\n; the newline inside the data is a bare \n and stays
    // inside its quoted field. Splitting on the real delimiter must therefore still yield
    // exactly header + one record, not a phantom third row that shifts every column after it.
    expect(csv.trimEnd().split('\r\n').length).toBe(2);
  });

  it('renders null and undefined as empty, not as the words', () => {
    const csv = toCsv([{ crimeNo: '1', name: 'A', n: 0, note: null }], cols);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
    expect(csv.trimEnd().endsWith(',')).toBe(true);
  });

  it('starts with a BOM so Excel reads Kannada names as UTF-8', () => {
    expect(toCsv([], cols).charCodeAt(0)).toBe(0xfeff);
  });
});

describe('paging params from a shared URL', () => {
  it('falls back instead of producing NaN', () => {
    // These views are shareable by design, so a hand-edited link is normal input. NaN here
    // reached rows.slice(NaN, NaN) and rendered an empty table that read as "no records".
    for (const bad of ['abc', '', '0', '-3', undefined]) {
      expect(clampPage(bad)).toBe(1);
      expect(clampPageSize(bad, 25)).toBe(25);
    }
    expect(clampPage('7')).toBe(7);
    expect(clampPageSize('100', 25)).toBe(100);
    expect(clampPageSize('99999', 25)).toBe(200); // clamped, not honoured
  });
});
