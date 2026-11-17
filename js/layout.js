// Grouping and page layout. All page measurements are in millimetres, measured
// from the top-left corner of the trimmed page (bleed is added only at export).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const sortPhotos = (list) =>
  [...list].sort((a, b) => (a.createTime < b.createTime ? -1 : a.createTime > b.createTime ? 1 : (a.filename || '').localeCompare(b.filename || '')));

const monthKey = (iso) => {
  const d = new Date(iso);
  return d.getFullYear() * 12 + d.getMonth();
};

export function monthName(iso, withYear) {
  const d = new Date(iso);
  return withYear ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : MONTHS[d.getMonth()];
}

// Group starts by calendar month (local time).
export function autoStarts(sorted) {
  const years = new Set(sorted.map((p) => new Date(p.createTime).getFullYear()));
  const starts = [];
  let last = null;
  for (const p of sorted) {
    const k = monthKey(p.createTime);
    if (k !== last) starts.push({ id: p.id, name: monthName(p.createTime, years.size > 1) });
    last = k;
  }
  return starts;
}

// -> [{ key, name, photos: [photo...] }] ; excluded photos stay in the list (flagged by caller).
export function buildGroups(sorted, starts) {
  const byId = new Map(starts.map((s) => [s.id, s]));
  const groups = [];
  for (const p of sorted) {
    const s = byId.get(p.id);
    if (s || !groups.length) groups.push({ key: s ? s.id : p.id, name: s ? s.name : monthName(p.createTime), photos: [] });
    groups.at(-1).photos.push(p);
  }
  return groups;
}

// ---------- Page layout ----------

export function titleSizeMm(s) {
  return Math.max(7, Math.min(18, Math.min(s.width, s.height) * 0.055));
}

function split(n, min, max) {
  if (n <= max) return [n];
  const pages = Math.ceil(n / max);
  const base = Math.floor(n / pages), extra = n % pages;
  return Array.from({ length: pages }, (_, i) => base + (i < extra ? 1 : 0));
}

// All ways to break n items into consecutive rows (bitmask of break points).
function* compositions(n) {
  const total = 1 << (n - 1);
  for (let mask = 0; mask < total; mask++) {
    const rows = [];
    let size = 1;
    for (let i = 0; i < n - 1; i++) {
      if (mask & (1 << i)) { rows.push(size); size = 1; } else size++;
    }
    rows.push(size);
    yield rows;
  }
}

// Justified rows that fill box (w × h) exactly; photos are cropped slightly (cover) to fit.
export function rowLayouts(aspects, w, h, gap) {
  const n = aspects.length;
  if (!n) return [[]];
  const options = [];
  const avgAspect = aspects.reduce((a, b) => a + b, 0) / n;
  const idealRows = Math.sqrt((n * avgAspect * h) / w); // rows that make every photo about the same size
  for (const rows of compositions(n)) {
    if (rows.some((r) => r > 5)) continue;
    let i = 0, sumH = 0;
    const heights = [];
    for (const r of rows) {
      const a = aspects.slice(i, i + r).reduce((x, y) => x + y, 0);
      const rh = (w - (r - 1) * gap) / a;
      heights.push(rh);
      sumH += rh;
      i += r;
    }
    const avail = h - (rows.length - 1) * gap;
    if (avail <= 0) continue;
    const f = avail / sumH;
    const logs = heights.map((x) => Math.log(x));
    const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
    const variance = logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length;
    // Lower is better: little cropping, even row heights, sensible row count.
    let score = Math.abs(Math.log(f)) + variance * 2.5 + Math.abs(rows.length - idealRows) * 0.25;
    if (n >= 5 && rows.some((r) => r === 1)) score += 0.35;
    options.push({ rows, heights: heights.map((x) => x * f), score });
  }
  options.sort((a, b) => a.score - b.score);
  return options.slice(0, 8).map(({ rows, heights }) => {
    const cells = [];
    let i = 0, y = 0;
    rows.forEach((r, ri) => {
      const rh = heights[ri];
      const a = aspects.slice(i, i + r);
      const sum = a.reduce((x, z) => x + z, 0);
      const avail = w - (r - 1) * gap;
      let x = 0;
      a.forEach((asp, k) => {
        const cw = k === r - 1 ? w - x : (avail * asp) / sum;
        cells.push({ x, y, w: cw, h: rh });
        x += cw + gap;
      });
      y += rh + gap;
      i += r;
    });
    return cells;
  });
}

const aspectOf = (p) => (p.width && p.height ? p.width / p.height : 1.5);

// Builds every page of the book.
// project: { settings, excluded:Set, shuffles:{}, coverId }
export function planBook(groups, project) {
  const s = project.settings;
  const W = s.width, H = s.height, m = s.margin, g = s.gap;
  const box = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  const pages = [];
  const visible = groups.map((gr) => ({ ...gr, photos: gr.photos.filter((p) => !project.excluded.has(p.id)) })).filter((gr) => gr.photos.length);

  if (s.cover) {
    const first = visible[0]?.photos[0];
    const coverId = project.coverId && visible.some((gr) => gr.photos.some((p) => p.id === project.coverId)) ? project.coverId : first?.id;
    const ts = titleSizeMm(s) * 1.5;
    const textH = ts * (s.subtitle ? 3.2 : 2.2);
    const cells = coverId ? [{ photoId: coverId, x: box.x, y: box.y, w: box.w, h: box.h - textH }] : [];
    pages.push({ type: 'cover', key: 'cover', cells, title: s.title, subtitle: s.subtitle, titleSize: ts, titleY: box.y + box.h - textH + ts * 1.55 });
  }

  for (const gr of visible) {
    const ts = titleSizeMm(s);
    if (s.titleMode === 'divider') pages.push({ type: 'divider', key: `div-${gr.key}`, title: gr.name, titleSize: ts * 1.6, group: gr.name });
    const sizes = split(gr.photos.length, s.minPer, s.maxPer);
    let i = 0;
    sizes.forEach((n, pi) => {
      const photos = gr.photos.slice(i, i + n);
      i += n;
      const header = s.titleMode === 'header' && pi === 0;
      const headerH = header ? ts * 2 : 0;
      const area = { x: box.x, y: box.y + headerH, w: box.w, h: box.h - headerH };
      const key = `${gr.key}-${pi}`;
      const options = rowLayouts(photos.map(aspectOf), area.w, area.h, g);
      const pick = options[(project.shuffles[key] || 0) % options.length];
      pages.push({
        type: 'photos', key, group: gr.name, variants: options.length,
        title: header ? gr.name : null, titleSize: ts, titleY: box.y + ts * 1.15,
        cells: pick.map((c, k) => ({ photoId: photos[k].id, x: area.x + c.x, y: area.y + c.y, w: c.w, h: c.h })),
      });
    });
  }

  if (s.evenPages && pages.length % 2) pages.push({ type: 'blank', key: 'blank-end', cells: [] });
  return pages;
}

// Crop rectangle (in source pixels) for object-fit: cover.
export function coverCrop(srcW, srcH, cellW, cellH) {
  const sa = srcW / srcH, ca = cellW / cellH;
  if (sa > ca) {
    const w = srcH * ca;
    return { sx: (srcW - w) / 2, sy: 0, sw: w, sh: srcH };
  }
  const h = srcW / ca;
  return { sx: 0, sy: (srcH - h) / 2, sw: srcW, sh: h };
}
