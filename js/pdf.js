// Exports: PDF (each page rendered at 300 dpi and embedded) and JPEG pages in a zip.
import { renderSheet, ensureFonts } from './render.js';
import { canvasToBlob } from './images.js';
import { ZipWriter } from './zip.js';

const PT = 72 / 25.4;
const tick = () => new Promise((r) => setTimeout(r, 0));
const safeName = (t) => String(t || '').replace(/[\\/:*?"<>|]+/g, '').trim();

// Writes the JFIF density so editors read the image as `dpi` (not 72).
async function jpegBytes(canvas, dpi) {
  const bytes = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46) {
    bytes[13] = 1;
    bytes[14] = dpi >> 8; bytes[15] = dpi & 255;
    bytes[16] = dpi >> 8; bytes[17] = dpi & 255;
  }
  return bytes;
}

export async function exportPdf(pages, s, { onProgress, dpi = 300 } = {}) {
  await ensureFonts(s);
  const doc = await PDFLib.PDFDocument.create();
  doc.setTitle(s.title || 'Photo book');
  doc.setCreator('Photobook');
  const k = dpi / 25.4;
  const pw = (s.width + 2 * s.bleed) * PT, ph = (s.height + 2 * s.bleed) * PT;
  for (let i = 0; i < pages.length; i++) {
    const canvas = await renderSheet([pages[i]], s, { k });
    const img = await doc.embedJpg(await jpegBytes(canvas, dpi));
    canvas.width = canvas.height = 0;
    doc.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    onProgress?.((i + 1) / pages.length);
    await tick();
  }
  return new Blob([await doc.save({ useObjectStreams: true })], { type: 'application/pdf' });
}

// Single pages, or spreads: page 1 alone, then 2–3, 4–5 … and the last page alone if it has no partner.
export function sheets(pages, spreads) {
  if (!spreads) return pages.map((p, i) => ({ pages: [p], first: i + 1 }));
  const out = [{ pages: [pages[0]], first: 1 }];
  for (let i = 1; i < pages.length; i += 2) out.push({ pages: pages.slice(i, i + 2), first: i + 1 });
  return out;
}

const labelOf = (p) => (p.type === 'title' ? 'Title page' : p.type === 'blank' ? 'Blank' : p.group);

export async function exportJpegs(pages, s, { spreads = false, covers = true, dpi = 300, onProgress } = {}) {
  await ensureFonts(s);
  const zip = new ZipWriter();
  const k = dpi / 25.4;
  const list = sheets(pages, spreads);
  const coverList = covers ? [['Cover - front', { type: 'front' }], ['Cover - back', { type: 'back' }]] : [];
  const total = list.length + coverList.length;
  let done = 0;

  for (const [name, page] of coverList) {
    const canvas = await renderSheet([page], s, { k });
    zip.add(`${name}.jpg`, await jpegBytes(canvas, dpi));
    canvas.width = canvas.height = 0;
    onProgress?.(++done / total);
    await tick();
  }

  const pad = String(pages.length).length;
  const num = (n) => String(n).padStart(pad, '0');
  for (const sh of list) {
    const canvas = await renderSheet(sh.pages, s, { k });
    const label = sh.pages.map(labelOf).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const range = sh.pages.length > 1 ? `${num(sh.first)}-${num(sh.first + 1)}` : num(sh.first);
    zip.add(`${range} ${safeName(label)}.jpg`, await jpegBytes(canvas, dpi));
    canvas.width = canvas.height = 0;
    onProgress?.(++done / total);
    await tick();
  }
  return zip.finish();
}
