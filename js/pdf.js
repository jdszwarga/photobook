// Print-ready PDF export with pdf-lib (vendored as window.PDFLib).
import { getPhoto } from './store.js';
import { decode, canvasToBlob } from './images.js';
import { coverCrop } from './layout.js';

const PT = 72 / 25.4; // points per mm

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function exportPdf(pages, settings, { onProgress, dpi = 300 } = {}) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(settings.title || 'Photo book');
  doc.setCreator('Photobook');
  const font = await doc.embedFont(settings.font === 'sans' ? StandardFonts.Helvetica : StandardFonts.TimesRoman);
  const b = settings.bleed;
  const pw = (settings.width + 2 * b) * PT, ph = (settings.height + 2 * b) * PT;
  const bg = hexToRgb(settings.bg), ink = hexToRgb(settings.ink);
  const total = pages.reduce((n, p) => n + (p.cells?.length || 0), 0) || 1;
  let done = 0;

  // pdf coordinates: origin bottom-left, includes bleed
  const X = (mm) => (mm + b) * PT;
  const Y = (mm) => ph - (mm + b) * PT;

  const drawText = (page, text, size, yMm) => {
    if (!text) return;
    const s = size * PT;
    let t = text;
    const maxW = (settings.width - 2 * settings.margin) * PT;
    while (font.widthOfTextAtSize(t, s) > maxW && t.length > 1) t = t.slice(0, -1);
    const w = font.widthOfTextAtSize(t, s);
    page.drawText(t, { x: X(settings.width / 2) - w / 2, y: Y(yMm), size: s, font, color: ink });
  };

  for (const p of pages) {
    const page = doc.addPage([pw, ph]);
    page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: bg });

    for (const c of p.cells || []) {
      const photo = await getPhoto(c.photoId);
      const bmp = await decode(photo.full);
      const crop = coverCrop(bmp.width, bmp.height, c.w, c.h);
      const scale = Math.min(1, ((c.w / 25.4) * dpi) / crop.sw);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(crop.sw * scale));
      canvas.height = Math.max(1, Math.round(crop.sh * scale));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
      bmp.close?.();
      const jpg = await doc.embedJpg(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer());
      page.drawImage(jpg, { x: X(c.x), y: Y(c.y + c.h), width: c.w * PT, height: c.h * PT });
      onProgress?.(++done / total);
    }

    if (p.type === 'cover') {
      drawText(page, p.title, p.titleSize, p.titleY);
      drawText(page, p.subtitle, p.titleSize * 0.5, p.titleY + p.titleSize * 1.05);
    } else if (p.type === 'divider') {
      drawText(page, p.title, p.titleSize, settings.height / 2 + p.titleSize * 0.35);
    } else if (p.title) {
      drawText(page, p.title, p.titleSize, p.titleY);
    }
    // Let the UI breathe between pages.
    await new Promise((r) => setTimeout(r, 0));
  }

  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}
