// One renderer for everything: on-screen preview (thumbnails), JPEG pages and PDF (full photos).
// Units are millimetres on the trimmed page; k = pixels per mm.
import { getPhoto } from './store.js';
import { decode } from './images.js';
import { coverCrop, titleSizeMm } from './layout.js';

export const FONTS = {
  'Fraunces': { weights: [400, 600, 700], fallback: 'serif' },
  'Playfair Display': { weights: [400, 600, 700], fallback: 'serif' },
  'Cormorant Garamond': { weights: [400, 600, 700], fallback: 'serif' },
  'Libre Baskerville': { weights: [400, 700], fallback: 'serif' },
  'DM Serif Display': { weights: [400], fallback: 'serif' },
  'Inter': { weights: [400, 600, 700], fallback: 'sans-serif' },
  'Montserrat': { weights: [400, 600, 700], fallback: 'sans-serif' },
  'Josefin Sans': { weights: [400, 600, 700], fallback: 'sans-serif' },
  'Raleway': { weights: [400, 600, 700], fallback: 'sans-serif' },
  'Bebas Neue': { weights: [400], fallback: 'sans-serif' },
  'Caveat': { weights: [400, 600, 700], fallback: 'cursive' },
  'Dancing Script': { weights: [400, 600, 700], fallback: 'cursive' },
};
export const FONT_NAMES = Object.keys(FONTS);

export function weightFor(s) {
  const ws = FONTS[s.font]?.weights || [400];
  return ws.reduce((best, w) => (Math.abs(w - s.titleWeight) < Math.abs(best - s.titleWeight) ? w : best), ws[0]);
}

export async function ensureFonts(s) {
  const f = FONTS[s.font] ? s.font : 'Fraunces';
  try {
    await Promise.all(FONTS[f].weights.map((w) => document.fonts.load(`${w} 24px "${f}"`, 'AaZz2026')));
  } catch {}
}

// ---------- Image sources ----------
// Preview uses cached thumbnails; export decodes full images one at a time.
const thumbCache = new Map();
export function thumbSource(getThumbBlob) {
  return async (id) => {
    if (!thumbCache.has(id)) thumbCache.set(id, getThumbBlob(id).then((b) => (b ? decode(b) : null)).catch(() => null));
    return { bmp: await thumbCache.get(id), done() {} };
  };
}
export async function fullSource(id) {
  const p = await getPhoto(id);
  if (!p) return { bmp: null, done() {} };
  const bmp = await decode(p.full);
  return { bmp, done: () => bmp.close?.() };
}
export const forgetThumbs = () => thumbCache.clear();

// ---------- Drawing helpers ----------
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
}

async function drawPhoto(ctx, source, id, rect, s, k, { framed = true } = {}) {
  const x = Math.round(rect.x * k), y = Math.round(rect.y * k);
  const w = Math.round((rect.x + rect.w) * k) - x, h = Math.round((rect.y + rect.h) * k) - y;
  const { bmp, done } = await source(id);
  const r = framed ? s.radius * k : 0;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  if (bmp) {
    const c = coverCrop(bmp.width, bmp.height, w, h);
    ctx.drawImage(bmp, c.sx, c.sy, c.sw, c.sh, x, y, w, h);
  } else {
    ctx.fillStyle = '#d9d4cc';
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  done();
  if (framed && s.stroke > 0) {
    const lw = s.stroke * k;
    ctx.save();
    roundRectPath(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, Math.max(0, r - lw / 2));
    ctx.lineWidth = lw;
    ctx.strokeStyle = s.strokeColor;
    ctx.stroke();
    ctx.restore();
  }
}

function text(ctx, s, str, { x, y, size, color, align = 'center', weight, k, maxW, tracking = s.titleTracking, upper = s.titleCase === 'upper' }) {
  if (!str) return;
  const t = upper ? str.toUpperCase() : str;
  const f = FONTS[s.font] ? s.font : 'Fraunces';
  ctx.font = `${weight ?? weightFor(s)} ${size * k}px "${f}", ${FONTS[f].fallback}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(tracking || 0) * size * k}px`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(t, x * k, y * k, maxW ? maxW * k : undefined);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function rule(ctx, s, { x, y, align, size, k }) {
  const len = Math.max(10, size * 1.6), th = Math.max(0.3, size * 0.045);
  ctx.fillStyle = s.accent;
  const x0 = align === 'left' ? x : x - len / 2;
  ctx.fillRect(x0 * k, y * k, len * k, th * k);
}

// Title + subtitle block placed inside a vertical region.
function titleBlock(ctx, s, { title, subtitle, region: [r0, r1], anchor, color, k, size }) {
  const A = size, B = size * 0.42;
  const hasSub = !!subtitle;
  const total = A * 0.78 + (hasSub ? A * 0.5 + B * 0.78 : 0);
  const y0 = anchor === 'top' ? r0 : anchor === 'bottom' ? r1 - total : (r0 + r1 - total) / 2;
  const align = s.titleAlign;
  const x = align === 'left' ? s.margin : s.width / 2;
  const maxW = s.width - 2 * s.margin;
  const tb = y0 + A * 0.78;
  text(ctx, s, title, { x, y: tb, size: A, color, align, k, maxW });
  if (hasSub) text(ctx, s, subtitle, { x, y: tb + A * 0.5 + B * 0.78, size: B, color, align, k, maxW, weight: 400, tracking: 0.12, upper: true });
}

function scrim(ctx, s, pos, strength, k, bleed) {
  if (!(strength > 0)) return;
  const W = (s.width + 2 * bleed) * k, H = (s.height + 2 * bleed) * k;
  const ox = -bleed * k, oy = -bleed * k;
  if (pos === 'center') {
    ctx.fillStyle = `rgba(0,0,0,${strength * 0.75})`;
    ctx.fillRect(ox, oy, W, H);
    return;
  }
  const g = pos === 'top' ? ctx.createLinearGradient(0, oy, 0, oy + H * 0.5) : ctx.createLinearGradient(0, oy + H, 0, oy + H * 0.5);
  g.addColorStop(0, `rgba(0,0,0,${strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(ox, oy, W, H);
}

// ---------- Page types ----------
const coverSize = (s) => titleSizeMm(s) * 1.5 * s.titleScale;

async function drawFront(ctx, s, source, k, b) {
  const f = s.front, W = s.width, H = s.height, m = s.margin;
  const A = coverSize(s);
  const block = A * 0.78 + (s.subtitle ? A * 0.5 + A * 0.42 * 0.78 : 0);
  const args = { title: s.title, subtitle: s.subtitle, k, size: A };
  if (!f.photoId) return titleBlock(ctx, s, { ...args, region: [m, H - m], anchor: 'center', color: s.ink });
  if (f.layout === 'full') {
    await drawPhoto(ctx, source, f.photoId, { x: -b, y: -b, w: W + 2 * b, h: H + 2 * b }, s, k, { framed: false });
    scrim(ctx, s, f.titlePos, f.overlay, k, b);
    titleBlock(ctx, s, { ...args, region: [m * 1.6, H - m * 1.6], anchor: f.titlePos, color: f.textColor });
  } else if (f.layout === 'band') {
    const ph = H * 0.68;
    await drawPhoto(ctx, source, f.photoId, { x: -b, y: -b, w: W + 2 * b, h: ph + b }, s, k, { framed: false });
    titleBlock(ctx, s, { ...args, region: [ph, H], anchor: 'center', color: s.ink });
  } else if (f.layout === 'inset') {
    const pw = W * 0.62, phh = Math.min(H * 0.56, pw * 1.1);
    const top = f.titlePos === 'top';
    const py = top ? H - m * 2 - phh : m * 2;
    await drawPhoto(ctx, source, f.photoId, { x: (W - pw) / 2, y: py, w: pw, h: phh }, s, k);
    titleBlock(ctx, s, { ...args, region: top ? [m, py] : [py + phh, H - m], anchor: 'center', color: s.ink });
  } else {
    // framed
    const textH = block + m * 1.2;
    await drawPhoto(ctx, source, f.photoId, { x: m, y: m, w: W - 2 * m, h: H - 2 * m - textH }, s, k);
    titleBlock(ctx, s, { ...args, region: [H - m - textH, H - m], anchor: 'center', color: s.ink });
  }
}

async function drawBack(ctx, s, source, k, b) {
  const bk = s.back, W = s.width, H = s.height, m = s.margin;
  const size = titleSizeMm(s) * 0.55;
  const line = (y, color) => text(ctx, s, bk.text, { x: W / 2, y, size, color, align: 'center', k, maxW: W - 2 * m, weight: 400 });
  if (!bk.photoId || bk.layout === 'none') return line(H / 2, s.ink);
  if (bk.layout === 'full') {
    await drawPhoto(ctx, source, bk.photoId, { x: -b, y: -b, w: W + 2 * b, h: H + 2 * b }, s, k, { framed: false });
    if (bk.text) scrim(ctx, s, 'bottom', Math.max(0.3, s.front.overlay), k, b);
    return line(H - m * 1.6, s.front.textColor);
  }
  if (bk.layout === 'framed') {
    const textH = bk.text ? size * 3 : 0;
    await drawPhoto(ctx, source, bk.photoId, { x: m, y: m, w: W - 2 * m, h: H - 2 * m - textH }, s, k);
    return line(H - m - size * 1.1, s.ink);
  }
  // small
  const pw = W * 0.44, ph = Math.min(H * 0.5, pw * 1.15);
  const py = H * 0.5 - ph * 0.62;
  await drawPhoto(ctx, source, bk.photoId, { x: (W - pw) / 2, y: py, w: pw, h: ph }, s, k);
  line(py + ph + size * 2.6, s.ink);
}

async function drawPage(ctx, page, s, source, k, b) {
  if (page.type === 'front' || page.type === 'title') return drawFront(ctx, s, source, k, b);
  if (page.type === 'back') return drawBack(ctx, s, source, k, b);
  for (const c of page.cells || []) await drawPhoto(ctx, source, c.photoId, c, s, k);
  const align = s.titleAlign;
  const x = align === 'left' ? s.margin : s.width / 2;
  if (page.type === 'divider') {
    const y = s.height / 2 + page.titleSize * 0.3;
    text(ctx, s, page.title, { x, y, size: page.titleSize, color: s.ink, align, k, maxW: s.width - 2 * s.margin });
    if (s.titleRule) rule(ctx, s, { x, y: y + page.titleSize * 0.45, align, size: page.titleSize, k });
  } else if (page.title) {
    text(ctx, s, page.title, { x, y: page.titleY, size: page.titleSize, color: s.ink, align, k, maxW: s.width - 2 * s.margin });
    if (s.titleRule) rule(ctx, s, { x, y: page.titleY + page.titleSize * 0.38, align, size: page.titleSize, k });
  }
}

// Draws a sheet (one page, or two facing pages) onto a new canvas. bleed in mm.
export async function renderSheet(pages, s, { k, bleed = s.bleed, source = fullSource, canvas = document.createElement('canvas') } = {}) {
  const n = pages.length;
  canvas.width = Math.max(1, Math.round((n * s.width + 2 * bleed) * k));
  canvas.height = Math.max(1, Math.round((s.height + 2 * bleed) * k));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let j = 0; j < n; j++) {
    ctx.save();
    ctx.translate((bleed + j * s.width) * k, bleed * k);
    if (n > 1) {
      // keep each page's full-bleed artwork on its own side of the spread
      ctx.beginPath();
      ctx.rect(j === 0 ? -bleed * k : 0, -bleed * k, (s.width + bleed) * k, (s.height + 2 * bleed) * k);
      ctx.clip();
    }
    await drawPage(ctx, pages[j], s, source, k, bleed);
    ctx.restore();
  }
  return canvas;
}
