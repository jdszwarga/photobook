// Page images: renders book pages (or facing-page spreads) to 300 dpi JPEGs with bleed, zipped.
import { getPhoto } from './store.js';
import { decode, canvasToBlob } from './images.js';
import { coverCrop } from './layout.js';
import { ZipWriter } from './zip.js';

const fontFor = (s) => (s.font === 'sans' ? 'Helvetica, Arial, sans-serif' : '"Times New Roman", Times, serif');

// Draws one page's content with its top-left trim corner at (ox, oy) mm.
async function drawPage(ctx, page, s, ox, oy, k) {
  for (const c of page.cells || []) {
    const photo = await getPhoto(c.photoId);
    const bmp = await decode(photo.full);
    const crop = coverCrop(bmp.width, bmp.height, c.w, c.h);
    const x = Math.round((ox + c.x) * k), y = Math.round((oy + c.y) * k);
    const w = Math.round((ox + c.x + c.w) * k) - x, h = Math.round((oy + c.y + c.h) * k) - y;
    ctx.drawImage(bmp, crop.sx, crop.sy, crop.sw, crop.sh, x, y, w, h);
    bmp.close?.();
  }
  const text = (t, size, baseline) => {
    if (!t) return;
    ctx.font = `${size * k}px ${fontFor(s)}`;
    ctx.fillStyle = s.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t, (ox + s.width / 2) * k, (oy + baseline) * k, (s.width - 2 * s.margin) * k);
  };
  if (page.type === 'cover') {
    text(page.title, page.titleSize, page.titleY);
    text(page.subtitle, page.titleSize * 0.5, page.titleY + page.titleSize * 1.05);
  } else if (page.type === 'divider') {
    text(page.title, page.titleSize, s.height / 2 + page.titleSize * 0.35);
  } else if (page.title) {
    text(page.title, page.titleSize, page.titleY);
  }
}

// Writes the JFIF density so editors read the image as dpi (not 72).
async function jpegWithDpi(canvas, dpi) {
  const bytes = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46) {
    bytes[13] = 1; // units: dots per inch
    bytes[14] = dpi >> 8; bytes[15] = dpi & 255;
    bytes[16] = dpi >> 8; bytes[17] = dpi & 255;
  }
  return bytes;
}

const safeName = (t) => String(t || '').replace(/[\\/:*?"<>|]+/g, '').trim();

// Single pages, or spreads: page 1 alone, then 2–3, 4–5 … and the last page alone if it has no partner.
export function sheets(pages, spreads) {
  if (!spreads) return pages.map((p, i) => ({ pages: [p], first: i + 1 }));
  const out = [{ pages: [pages[0]], first: 1 }];
  for (let i = 1; i < pages.length; i += 2) out.push({ pages: pages.slice(i, i + 2), first: i + 1 });
  return out;
}

export async function exportJpegs(pages, s, { spreads = false, dpi = 300, onProgress } = {}) {
  const zip = new ZipWriter();
  const k = dpi / 25.4; // px per mm
  const b = s.bleed;
  const list = sheets(pages, spreads);
  const pad = String(pages.length).length;
  const num = (n) => String(n).padStart(pad, '0');

  for (let i = 0; i < list.length; i++) {
    const sh = list[i];
    const n = sh.pages.length;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((n * s.width + 2 * b) * k);
    canvas.height = Math.round((s.height + 2 * b) * k);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let j = 0; j < n; j++) await drawPage(ctx, sh.pages[j], s, b + j * s.width, b, k);

    const label = sh.pages.map((p) => (p.type === 'cover' ? 'Cover' : p.type === 'blank' ? 'Blank' : p.group)).filter((v, idx, a) => a.indexOf(v) === idx).join(', ');
    const range = n > 1 ? `${num(sh.first)}-${num(sh.first + 1)}` : num(sh.first);
    zip.add(`${range} ${safeName(label)}.jpg`, await jpegWithDpi(canvas, dpi));
    canvas.width = canvas.height = 0; // free memory
    onProgress?.((i + 1) / list.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return zip.finish();
}
