// pages.ts — turning whatever an officer selected into a list of page images.
//
// WHY THIS EXISTS. The evidence readers take one image. What an officer actually holds is a
// three-page case diary, or a PDF a court sent, or four photographs of the same seizure taken
// from different angles. Making them upload those one at a time — and then stitch the readings
// back together by hand — is the retyping problem this screen exists to remove, moved one step
// along.
//
// So the screen accepts a PDF or several images, and everything downstream sees a list of
// pages. A single photograph is a list of one, which means there is no special case anywhere
// else.
//
// THE PDF ENGINE IS LAZY-LOADED, AND THAT IS NOT AN OPTIMISATION DETAIL. pdf.js is about a
// megabyte. The bundle is already large enough to warn on build, and the overwhelming majority
// of readings are a phone photograph that never touches this code. Loading it on the first PDF
// rather than on every page load keeps that cost with the people who asked for it.
//
// PAGES ARE CAPPED. A 400-page charge sheet dropped on this screen would render 400 canvases
// and fire 400 model calls, which is a browser hang and a bill. The cap is stated in the UI and
// reported back here rather than silently applied -- a truncated read that claims to be a whole
// document is the kind of quiet wrongness that ends up in a case file.

export type Page = {
  blob: Blob;
  /** 1-based, for labels a human reads. */
  index: number;
  label: string;
  mime: string;
};

export type Extracted = {
  pages: Page[];
  /** Pages the source had but the cap excluded. Zero for everything normal. */
  dropped: number;
  source: 'image' | 'pdf' | 'images';
};

export const MAX_PAGES = 10;

// A page rendered below roughly this width loses handwriting to the OCR engine; far above it
// costs upload time and the readers downsample anyway. Measured against the memo fixture at
// 99% confidence.
const TARGET_WIDTH = 1600;

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not render the page'))), 'image/png');
  });
}

/** Render every page of a PDF to a PNG blob. */
async function pdfToPages(file: File): Promise<Extracted> {
  // Loaded here, on the first PDF, rather than at module scope. Vite splits this into its own
  // chunk because the import is dynamic.
  const pdfjs = await import('pdfjs-dist');
  // The worker has to be addressed as a URL Vite has fingerprinted, not a bare path — a
  // hard-coded '/pdf.worker.mjs' resolves to nothing once the app is served from /app/.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  // The loading task is kept, not discarded: destroy() lives on the task rather than on the
  // document, and without it the worker and the whole decoded document stay in memory for the
  // life of the tab. On a screen an officer uses all shift, that is the leak that matters.
  const task = pdfjs.getDocument({ data: buf });
  const doc = await task.promise;
  const total = doc.numPages;
  const take = Math.min(total, MAX_PAGES);
  const pages: Page[] = [];

  for (let n = 1; n <= take; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, TARGET_WIDTH / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('this browser cannot render a PDF page');
    // White behind the page. A PDF renders onto transparency, and transparency flattens to
    // black in a JPEG/PNG the OCR engine then reads as an unreadable page.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // eslint-disable-next-line no-await-in-loop
    await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
    // eslint-disable-next-line no-await-in-loop
    const blob = await canvasToBlob(canvas);
    pages.push({ blob, index: n, label: `Page ${n}`, mime: 'image/png' });
    page.cleanup();
  }
  await task.destroy();
  return { pages, dropped: total - take, source: 'pdf' };
}

/**
 * Turn the officer's selection into pages.
 *
 * One photograph is a list of one. That is the whole trick: nothing downstream needs to know
 * whether it is reading a phone snap or page three of a case diary.
 */
export async function toPages(files: File[]): Promise<Extracted> {
  const list = Array.from(files || []);
  if (!list.length) return { pages: [], dropped: 0, source: 'images' };

  if (list.length === 1 && list[0].type === 'application/pdf') {
    return pdfToPages(list[0]);
  }

  const images = list.filter((f) => /^image\//.test(f.type || ''));
  if (!images.length) {
    throw new Error('These readers take photographs, scans or a PDF. That file is neither.');
  }
  const take = images.slice(0, MAX_PAGES);
  return {
    pages: take.map((f, i) => ({
      blob: f,
      index: i + 1,
      label: take.length > 1 ? `Page ${i + 1} — ${f.name}` : f.name,
      mime: f.type || 'image/jpeg',
    })),
    dropped: images.length - take.length,
    source: images.length > 1 ? 'images' : 'image',
  };
}

/**
 * Join per-page readings into the text that gets filed.
 *
 * A single page files as itself, with no marker: a one-page memo prefixed "Page 1 of 1" reads
 * like a fragment of something larger. Several pages carry markers, because a reader six months
 * later needs to know where page two started and that page three was blank.
 */
export function joinPages(readings: { label: string; text: string; ok: boolean }[]): string {
  const good = readings.filter((r) => r.ok);
  if (good.length === 1 && readings.length === 1) return good[0].text;
  return readings
    .map((r) => `--- ${r.label} ---\n${r.ok ? r.text : '(not read)'}`)
    .join('\n\n');
}
