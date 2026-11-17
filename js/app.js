import * as store from './store.js';
import * as gp from './google.js';
import { prepare, exifDate } from './images.js';
import { sortPhotos, autoStarts, buildGroups, planBook, monthName } from './layout.js';
import { exportPdf, exportJpegs } from './pdf.js';
import { renderSheet, ensureFonts, thumbSource, forgetThumbs, FONTS, FONT_NAMES } from './render.js';
import * as ai from './ai.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const MM_PER_IN = 25.4;

// Diamond Photo / Kroma: nominal trim sizes from their range.
// MILK sizes are their custom-upload sizes minus the 3 mm bleed on each side.
const PRESETS = [
  ['dp-28sq', 'Diamond Photo 28 × 28 cm (layflat)', 280, 280],
  ['dp-30sq', 'Diamond Photo 30 × 30 cm (classic)', 300, 300],
  ['dp-28x20', 'Diamond Photo 28 × 20 cm landscape', 280, 200],
  ['dp-20sq', 'Diamond Photo 20 × 20 cm', 200, 200],
  ['milk-lsq', 'MILK Premium Large Square (27.9 cm)', 279.4, 279.4],
  ['milk-msq', 'MILK Premium Medium Square (20.3 cm)', 203.2, 203.2],
  ['milk-lland', 'MILK Premium Large Landscape', 323, 241],
  ['milk-classic-lland', 'MILK Classic Large Landscape', 330.2, 279.4],
  ['30x30cm', '30 × 30 cm square', 300, 300],
  ['20x20cm', '20 × 20 cm square', 200, 200],
  ['12x12in', '12 × 12 in square', 304.8, 304.8],
  ['10x10in', '10 × 10 in square', 254, 254],
  ['8x8in', '8 × 8 in square', 203.2, 203.2],
  ['a4l', 'A4 landscape', 297, 210],
  ['a4p', 'A4 portrait', 210, 297],
  ['11x8.5in', '11 × 8.5 in landscape', 279.4, 215.9],
  ['8.5x11in', '8.5 × 11 in portrait', 215.9, 279.4],
  ['custom', 'Custom size', null, null],
];

const DEFAULT_SETTINGS = {
  title: 'Our Year', subtitle: String(new Date().getFullYear()),
  preset: 'dp-28sq', width: 280, height: 280, unit: 'mm',
  bleed: 3, margin: 12, gap: 3, evenPages: true, cover: false,
  minPer: 7, maxPer: 10, titleMode: 'header',
  font: 'Fraunces', titleWeight: 600, titleCase: 'none', titleAlign: 'center', titleScale: 1, titleTracking: 0, titleRule: false,
  bg: '#ffffff', ink: '#222222', accent: '#c2562d', radius: 0, stroke: 0, strokeColor: '#ffffff',
  front: { photoId: null, layout: 'full', titlePos: 'bottom', overlay: 0.35, textColor: '#ffffff' },
  back: { photoId: null, layout: 'small', text: '' },
};
const freshSettings = () => structuredClone(DEFAULT_SETTINGS);

// ---------- State ----------
const state = {
  step: 'photos',
  photos: [], // sorted metadata incl. thumb blob
  project: { settings: freshSettings(), starts: null, excluded: new Set(), shuffles: {} },
  selected: null,
};
const thumbUrls = new Map();
const thumbUrl = (p) => {
  if (!thumbUrls.has(p.id)) thumbUrls.set(p.id, URL.createObjectURL(p.thumb));
  return thumbUrls.get(p.id);
};

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const p = state.project;
    store.setKV('project', { ...p, excluded: [...p.excluded] });
  }, 250);
}

async function load() {
  const saved = await store.getKV('project');
  if (saved) {
    const d = freshSettings(), ss = saved.settings || {};
    const settings = { ...d, ...ss, front: { ...d.front, ...ss.front }, back: { ...d.back, ...ss.back } };
    // older saves: 'serif'/'sans' fonts and a single cover photo
    if (!FONTS[settings.font]) settings.font = settings.font === 'sans' ? 'Inter' : 'Fraunces';
    if (saved.coverId && !settings.front.photoId) settings.front.photoId = saved.coverId;
    delete saved.coverId;
    state.project = { ...state.project, ...saved, settings, excluded: new Set(saved.excluded || []) };
  }
  state.photos = sortPhotos(await store.allPhotoMeta());
}

const starts = () => state.project.starts ?? autoStarts(state.photos);
const groups = () => buildGroups(state.photos, starts());
const pages = () => planBook(groups(), state.project);

// Cover photos default to the first and last photos in the book.
function coverIds() {
  const f = state.project.settings.front, b = state.project.settings.back;
  const has = (id) => id && state.photos.some((p) => p.id === id);
  const visible = state.photos.filter((p) => !state.project.excluded.has(p.id));
  return { front: has(f.photoId) ? f.photoId : visible[0]?.id ?? null, back: has(b.photoId) ? b.photoId : visible.at(-1)?.id ?? null };
}
// Settings with cover photo ids resolved, as the renderer needs them.
function renderSettings() {
  const s = state.project.settings, c = coverIds();
  return { ...s, front: { ...s.front, photoId: c.front }, back: { ...s.back, photoId: c.back } };
}

// ---------- Navigation ----------
function go(step) {
  if (step !== 'photos' && !state.photos.length) step = 'photos';
  state.step = step;
  for (const v of ['photos', 'groups', 'design']) $(`#view-${v}`).hidden = v !== step;
  const order = ['photos', 'groups', 'design'];
  $$('.step').forEach((b) => {
    const i = order.indexOf(b.dataset.step);
    b.classList.toggle('active', b.dataset.step === step);
    b.classList.toggle('done', i < order.indexOf(step));
    b.disabled = i > 0 && !state.photos.length;
  });
  $('#exportBtn').disabled = !state.photos.length;
  if (step === 'photos') renderImport();
  if (step === 'groups') renderGroups();
  if (step === 'design') renderDesign();
  history.replaceState(null, '', `#${step}`);
}

$$('.step').forEach((b) => b.addEventListener('click', () => go(b.dataset.step)));
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (['photos', 'groups', 'design'].includes(h) && h !== state.step) go(h);
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-goto]');
  if (t) go(t.dataset.goto);
});

function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

const fmtDate = (iso, opts = { month: 'short', day: 'numeric' }) => new Date(iso).toLocaleDateString(undefined, opts);

// ---------- 1. Import ----------
function renderImport() {
  const n = state.photos.length;
  $('#importTitle').textContent = n ? 'Your photos' : 'Start with your year in photos';
  $('#importLead').hidden = !!n;
  $('#importFoot').hidden = !n;
  $('#googleBtn span').textContent = n ? 'Add more from Google Photos' : 'Choose from Google Photos';
  const sum = $('#importSummary');
  sum.hidden = !n;
  if (n) {
    const first = state.photos[0], last = state.photos.at(-1);
    const picks = [0, 0.25, 0.5, 0.75, 1].map((f) => state.photos[Math.round(f * (n - 1))]).filter((p, i, a) => a.indexOf(p) === i);
    sum.innerHTML = `<div class="mosaic">${picks.map((p) => `<img src="${thumbUrl(p)}" alt="">`).join('')}</div>
      <div><strong>${n} photo${n === 1 ? '' : 's'}</strong><span>${fmtDate(first.createTime, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDate(last.createTime, { day: 'numeric', month: 'short', year: 'numeric' })} · ${groups().length} groups</span></div>`;
  }
  const note = $('#googleNote');
  if (!gp.isConfigured()) {
    note.hidden = false;
    note.textContent = 'Google sign-in isn’t set up yet. Add your Google OAuth client ID to js/config.js (see README → Google setup).';
  } else if (gp.hasToken()) {
    note.hidden = true;
  }
}

let abort = null;

$('#googleBtn').addEventListener('click', async () => {
  if (!gp.isConfigured()) return toast('Add your Google client ID to js/config.js first.');
  if (abort) return;
  if (!gp.hasToken()) {
    try {
      await gp.signIn();
      $('#googleBtn span').textContent = 'Open Google Photos';
      const note = $('#googleNote');
      note.hidden = false;
      note.textContent = 'Signed in. Click “Open Google Photos” to choose your photos.';
    } catch (e) {
      toast(e.message);
    }
    return;
  }
  // Open the window now (inside the click) so it isn't blocked as a popup.
  const win = window.open('', 'gphotos-picker', 'width=1100,height=800');
  abort = new AbortController();
  showProgress('Opening Google Photos…', 0);
  try {
    const items = await gp.pick(win, { signal: abort.signal, onStatus: (t) => showProgress(t, 0) });
    await importItems(items.map((it) => ({ ...it, source: 'google', fetch: () => gp.download(it) })));
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message, 6000);
  } finally {
    if (win && !win.closed) win.close();
    endImport();
  }
});

$('#fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || abort) return;
  abort = new AbortController();
  try {
    const items = await Promise.all(files.map(async (f) => ({
      id: `local-${f.name}-${f.size}-${f.lastModified}`,
      createTime: (await exifDate(f)) || new Date(f.lastModified).toISOString(),
      filename: f.name, mimeType: f.type, source: 'local', fetch: async () => f,
    })));
    await importItems(items);
  } finally {
    endImport();
  }
});

$('#cancelBtn').addEventListener('click', () => abort?.abort());

function showProgress(text, frac) {
  $('#progress').hidden = false;
  $('#progressText').textContent = text;
  $('#progressBar').style.width = `${Math.round(frac * 100)}%`;
}

function endImport() {
  abort = null;
  $('#progress').hidden = true;
  renderImport();
  go(state.step);
}

async function importItems(items) {
  const known = new Set(state.photos.map((p) => p.id));
  const todo = items.filter((it) => !known.has(it.id));
  const skipped = items.length - todo.length;
  const errors = [];
  const monthsBefore = new Set(state.photos.map((p) => monthName(p.createTime, true)));
  let done = 0;
  showProgress(`Saving ${todo.length} photos…`, 0);
  const queue = [...todo];
  const worker = async () => {
    while (queue.length && !abort.signal.aborted) {
      const it = queue.shift();
      try {
        const blob = await it.fetch();
        const { full, thumb, width, height } = await prepare(blob);
        const rec = { id: it.id, createTime: it.createTime, filename: it.filename, mimeType: it.mimeType, source: it.source, width, height, thumb, full };
        await store.putPhoto(rec);
        const { full: _f, ...meta } = rec;
        state.photos.push(meta);
      } catch (e) {
        errors.push(`${it.filename || it.id}: ${/HEI[CF]/i.test(it.filename) && it.source === 'local' ? 'HEIC files can’t be read from this computer; use Google Photos instead' : e.message}`);
      }
      done++;
      showProgress(`Saved ${done} of ${todo.length} photos`, done / todo.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  state.photos = sortPhotos(state.photos);
  if (state.project.starts) addStartsForNewMonths(monthsBefore);
  save();
  const box = $('#importErrors');
  box.hidden = !errors.length;
  box.innerHTML = errors.length ? `<strong>${errors.length} photo${errors.length === 1 ? '' : 's'} couldn’t be added:</strong><br>${errors.slice(0, 8).map(esc).join('<br>')}${errors.length > 8 ? '<br>…' : ''}` : '';
  const added = done - errors.length;
  toast(`${added} photo${added === 1 ? '' : 's'} added${skipped ? `, ${skipped} already in the book` : ''}.`);
}

// When groups were customised and new photos arrive from a month that had none, give that month its own group.
function addStartsForNewMonths(monthsBefore) {
  const st = state.project.starts;
  const ids = new Set(st.map((s) => s.id));
  const byId = new Map(state.photos.map((p) => [p.id, p]));
  for (const a of autoStarts(state.photos)) {
    if (!monthsBefore.has(monthName(byId.get(a.id).createTime, true)) && !ids.has(a.id)) st.push(a);
  }
  sortStarts(st);
}

$('#clearBtn').addEventListener('click', async () => {
  if (!confirm('Remove all photos and settings from this browser? Your Google Photos are not affected.')) return;
  await store.clearAll();
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls.clear();
  state.photos = [];
  state.project = { settings: freshSettings(), starts: null, excluded: new Set(), shuffles: {} };
  forgetThumbs();
  $('#importErrors').hidden = true;
  go('photos');
});

// ---------- 2. Groups ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function renderGroups() {
  const gs = groups();
  const ex = state.project.excluded;
  const cov = coverIds();
  $('#groupList').innerHTML = gs.map((g, gi) => {
    const inBook = g.photos.filter((p) => !ex.has(p.id)).length;
    const range = `${fmtDate(g.photos[0].createTime)} – ${fmtDate(g.photos.at(-1).createTime)}`;
    return `<section class="group" data-gi="${gi}">
      <div class="group-head">
        <input class="group-name" value="${esc(g.name)}" data-key="${esc(g.key)}" aria-label="Group name">
        <span class="group-meta">${inBook} photo${inBook === 1 ? '' : 's'}${inBook !== g.photos.length ? ` (${g.photos.length - inBook} excluded)` : ''} · ${range}</span>
        ${gi > 0 ? `<button class="link" data-merge="${gi}">Merge into ${esc(gs[gi - 1].name)}</button>` : ''}
      </div>
      <div class="thumbs">${g.photos.map((p) => `<button class="thumb${ex.has(p.id) ? ' excluded' : ''}${p.id === cov.front ? ' cover' : p.id === cov.back ? ' cover-back' : ''}${p.id === state.selected ? ' selected' : ''}" data-id="${esc(p.id)}" title="${esc(p.filename)}"><img loading="lazy" src="${thumbUrl(p)}" alt=""><span class="date">${fmtDate(p.createTime)}</span></button>`).join('')}</div>
    </section>`;
  }).join('');
  renderSelBar();
}

function editStarts(fn) {
  state.project.starts ??= autoStarts(state.photos);
  fn(state.project.starts);
  state.project.shuffles = {};
  save();
  renderGroups();
}

$('#groupList').addEventListener('change', (e) => {
  const inp = e.target.closest('.group-name');
  if (!inp) return;
  const name = inp.value.trim() || inp.defaultValue;
  editStarts((st) => {
    const s = st.find((x) => x.id === inp.dataset.key);
    if (s) s.name = name;
    else st.unshift({ id: inp.dataset.key, name });
  });
});
$('#groupList').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.group-name')) e.target.blur();
});

$('#groupList').addEventListener('click', (e) => {
  const m = e.target.closest('[data-merge]');
  if (m) {
    const key = groups()[+m.dataset.merge].key;
    return editStarts((st) => st.splice(st.findIndex((s) => s.id === key), 1));
  }
  const t = e.target.closest('.thumb');
  if (t) {
    state.selected = state.selected === t.dataset.id ? null : t.dataset.id;
    $$('.thumb.selected').forEach((x) => x.classList.remove('selected'));
    if (state.selected) t.classList.add('selected');
    renderSelBar();
  }
});

function locate(id) {
  const gs = groups();
  for (let gi = 0; gi < gs.length; gi++) {
    const pi = gs[gi].photos.findIndex((p) => p.id === id);
    if (pi >= 0) return { gs, gi, pi, g: gs[gi] };
  }
  return null;
}

function renderSelBar() {
  const bar = $('#selBar');
  const loc = state.selected && locate(state.selected);
  bar.hidden = !loc;
  if (!loc) return;
  const p = loc.g.photos[loc.pi];
  $('#selThumb').src = thumbUrl(p);
  $('#selDate').textContent = fmtDate(p.createTime, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  $('#selName').textContent = `${loc.g.name} · ${p.filename || ''}`;
  bar.querySelector('[data-act=prev]').disabled = loc.gi === 0;
  bar.querySelector('[data-act=start]').disabled = loc.pi === 0;
  bar.querySelector('[data-act=next]').disabled = loc.gi === loc.gs.length - 1 && loc.pi === 0;
  $('#excludeBtn').textContent = state.project.excluded.has(p.id) ? 'Include' : 'Exclude';
}

$('#selBar').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const id = state.selected;
  const loc = locate(id);
  if (act === 'close' || !loc) { state.selected = null; return renderGroups(); }
  const { g, gs, gi, pi } = loc;
  if (act === 'start') {
    editStarts((st) => st.push({ id, name: monthName(g.photos[pi].createTime) }) && sortStarts(st));
  } else if (act === 'prev') {
    // This photo and everything before it in its group join the previous group.
    editStarts((st) => {
      const i = st.findIndex((s) => s.id === g.key);
      const next = g.photos[pi + 1];
      if (next) st[i].id = next.id; else st.splice(i, 1);
    });
    toast(`Moved to ${gs[gi - 1].name}`);
  } else if (act === 'next') {
    // This photo and everything after it in its group join the next group.
    editStarts((st) => {
      const i = st.findIndex((s) => s.id === g.key);
      if (gi === gs.length - 1) { st.push({ id, name: monthName(g.photos[pi].createTime) }); return; }
      const ni = st.findIndex((s) => s.id === gs[gi + 1].key);
      st[ni].id = id;
      if (pi === 0 && i >= 0) st.splice(i, 1);
    });
    if (gi < gs.length - 1) toast(`Moved to ${gs[gi + 1].name}`);
  } else if (act === 'exclude') {
    const ex = state.project.excluded;
    ex.has(id) ? ex.delete(id) : ex.add(id);
    state.project.shuffles = {};
    save();
    renderGroups();
  } else if (act === 'front' || act === 'back') {
    state.project.settings[act].photoId = id;
    save();
    renderGroups();
    toast(act === 'front' ? 'Front cover photo set' : 'Back cover photo set');
  }
});

function sortStarts(st) {
  const order = new Map(state.photos.map((p, i) => [p.id, i]));
  st.sort((a, b) => order.get(a.id) - order.get(b.id));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selected) { state.selected = null; renderGroups(); }
});

$('#resetGroupsBtn').addEventListener('click', () => {
  if (state.project.starts && !confirm('Reset all groups to calendar months? Custom names and boundaries will be lost.')) return;
  state.project.starts = null;
  state.project.shuffles = {};
  save();
  renderGroups();
});

// ---------- 3. Design ----------
const S = () => state.project.settings;
const toUnit = (mm) => (S().unit === 'in' ? +(mm / MM_PER_IN).toFixed(3) : +mm.toFixed(1));
const fromUnit = (v) => (S().unit === 'in' ? v * MM_PER_IN : v);

$('#s-preset').innerHTML = PRESETS.map(([k, label]) => `<option value="${k}">${label}</option>`).join('');

const WEIGHT_NAMES = { 400: 'Regular', 600: 'Semibold', 700: 'Bold' };
$('#s-font').innerHTML = FONT_NAMES.map((f) => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('');
$('#c-model').innerHTML = ai.MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');

const nearestWeight = (s) => FONTS[s.font].weights.reduce((b, w) => (Math.abs(w - s.titleWeight) < Math.abs(b - s.titleWeight) ? w : b));
const setSeg = (id, v) => $$(`${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v));

function fillPanel() {
  const s = S();
  $('#s-title').value = s.title;
  $('#s-subtitle').value = s.subtitle;
  $('#s-cover').checked = s.cover;
  $('#s-even').checked = s.evenPages;
  $('#s-preset').value = s.preset;
  for (const k of ['width', 'height', 'bleed', 'margin', 'gap']) {
    $(`#s-${k}`).value = toUnit(s[k]);
    $(`#s-${k}`).step = s.unit === 'in' ? '0.125' : '1';
  }
  $('#s-min').value = s.minPer;
  $('#s-max').value = s.maxPer;
  $('#s-titleMode').value = s.titleMode;
  $('#s-font').value = s.font;
  $('#s-font').style.fontFamily = `'${s.font}'`;
  $('#s-weight').innerHTML = FONTS[s.font].weights.map((w) => `<option value="${w}">${WEIGHT_NAMES[w]}</option>`).join('');
  $('#s-weight').value = String(nearestWeight(s));
  setSeg('#s-unit', s.unit);
  setSeg('#s-case', s.titleCase);
  setSeg('#s-align', s.titleAlign);
  $('#s-scale').value = s.titleScale;
  $('#s-tracking').value = s.titleTracking;
  $('#s-rule').checked = s.titleRule;
  for (const k of ['bg', 'ink', 'accent', 'strokeColor']) $(`#s-${k}`).value = s[k];
  $('#s-radius').value = s.radius;
  $('#s-stroke').value = s.stroke;
  $('#f-layout').value = s.front.layout;
  $('#f-pos').value = s.front.titlePos;
  $('#f-overlay').value = s.front.overlay;
  $('#f-text').value = s.front.textColor;
  $('#b-layout').value = s.back.layout;
  $('#b-text').value = s.back.text;
  const c = coverIds();
  const byId = (id) => state.photos.find((p) => p.id === id);
  $('#frontThumb').src = c.front ? thumbUrl(byId(c.front)) : '';
  $('#backThumb').src = c.back ? thumbUrl(byId(c.back)) : '';
  fillClaude();
}

function setting(fn) {
  fn(S());
  save();
  renderPagesSoon();
}
const bind = (sel, ev, fn) => $(sel).addEventListener(ev, (e) => setting((s) => fn(s, e.target)));

bind('#s-title', 'input', (s, t) => (s.title = t.value));
bind('#s-subtitle', 'input', (s, t) => (s.subtitle = t.value));
bind('#s-cover', 'change', (s, t) => (s.cover = t.checked));
bind('#s-even', 'change', (s, t) => (s.evenPages = t.checked));
bind('#s-titleMode', 'change', (s, t) => (s.titleMode = t.value));
bind('#s-weight', 'change', (s, t) => (s.titleWeight = +t.value));
bind('#s-scale', 'input', (s, t) => (s.titleScale = +t.value));
bind('#s-tracking', 'input', (s, t) => (s.titleTracking = +t.value));
bind('#s-rule', 'change', (s, t) => (s.titleRule = t.checked));
for (const k of ['bg', 'ink', 'accent', 'strokeColor']) bind(`#s-${k}`, 'input', (s, t) => (s[k] = t.value));
bind('#s-radius', 'input', (s, t) => (s.radius = +t.value));
bind('#s-stroke', 'input', (s, t) => (s.stroke = +t.value));
bind('#f-layout', 'change', (s, t) => (s.front.layout = t.value));
bind('#f-pos', 'change', (s, t) => (s.front.titlePos = t.value));
bind('#f-overlay', 'input', (s, t) => (s.front.overlay = +t.value));
bind('#f-text', 'input', (s, t) => (s.front.textColor = t.value));
bind('#b-layout', 'change', (s, t) => (s.back.layout = t.value));
bind('#b-text', 'input', (s, t) => (s.back.text = t.value));
$('#s-font').addEventListener('change', (e) => {
  setting((s) => {
    s.font = e.target.value;
    s.titleWeight = nearestWeight(s);
  });
  fillPanel();
});
for (const [id, key] of [['#s-case', 'titleCase'], ['#s-align', 'titleAlign']]) {
  $(id).addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) { setting((s) => (s[key] = v)); setSeg(id, v); }
  });
}

$('#s-preset').addEventListener('change', (e) => {
  const p = PRESETS.find((x) => x[0] === e.target.value);
  setting((s) => {
    s.preset = p[0];
    if (p[2]) {
      s.width = p[2];
      s.height = p[3];
      const unit = p[0].endsWith('in') ? 'in' : 'mm';
      if (unit !== s.unit) {
        // Swap default spacing for the round numbers printers use in that unit.
        const swap = unit === 'in' ? { 3: 3.175, 12: 12.7 } : { 3.175: 3, 12.7: 12 };
        for (const k of ['bleed', 'margin', 'gap']) s[k] = swap[s[k]] ?? s[k];
      }
      s.unit = unit;
      if (p[0].startsWith('milk')) s.bleed = 3; // MILK uploads include exactly 3 mm bleed
    }
  });
  fillPanel();
});
for (const k of ['width', 'height', 'bleed', 'margin', 'gap']) {
  $(`#s-${k}`).addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (!(v >= 0)) return;
    setting((s) => {
      s[k] = fromUnit(v);
      if (k === 'width' || k === 'height') { s.preset = 'custom'; $('#s-preset').value = 'custom'; }
    });
  });
}
for (const [id, key] of [['#s-min', 'minPer'], ['#s-max', 'maxPer']]) {
  $(id).addEventListener('change', (e) => {
    const v = Math.max(1, Math.min(12, Math.round(+e.target.value) || 1));
    setting((s) => {
      s[key] = v;
      if (s.minPer > s.maxPer) key === 'minPer' ? (s.maxPer = v) : (s.minPer = v);
    });
    state.project.shuffles = {};
    fillPanel();
  });
}
$('#s-unit').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (v) { S().unit = v; save(); fillPanel(); renderPagesSoon(); }
});

function renderDesign() {
  fillPanel();
  renderPages();
}

let renderTimer;
function renderPagesSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPages, 150);
}

// Preview: every page is drawn by the same renderer as the export, using thumbnails.
const previewSource = thumbSource(async (id) => state.photos.find((p) => p.id === id)?.thumb);
let renderGen = 0;

async function renderPages() {
  const gen = ++renderGen;
  const s = renderSettings();
  const ps = pages();
  const container = $('#pages');
  const k = 300 / Math.max(s.width, s.height); // px per mm on screen
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = s.width * k, ph = s.height * k;
  container.style.setProperty('--page-w', `${pw}px`);
  const pageBox = (id) => `<div class="page" style="width:${pw}px;height:${ph}px"><canvas data-page="${id}"></canvas></div>`;

  const coverRow = `<div class="cover-row"><div class="spread">${pageBox('back')}${pageBox('front')}</div>
    <div class="page-label"><span>Back cover</span><span>Front cover</span></div></div>`;
  container.innerHTML = ps.length ? coverRow + ps.map((p, i) => {
    const label = p.type === 'title' ? 'Title page' : p.type === 'blank' ? 'Blank (for even page count)' : `${p.group}`;
    const shuffle = p.type === 'photos' && p.variants > 1 ? `<button data-shuffle="${esc(p.key)}" title="Try another arrangement">↻ Layout</button>` : '';
    return `<div class="page-wrap">${pageBox(i)}<div class="page-label"><span>${i + 1} · ${esc(label)}</span>${shuffle}</div></div>`;
  }).join('') : '<p class="empty">No photos in the book yet.</p>';

  const photoCount = ps.reduce((n, p) => n + (p.type === 'photos' ? p.cells.length : 0), 0);
  const unit = s.unit === 'in' ? 'in' : 'mm';
  $('#bookStats').innerHTML = `<strong>${ps.length} pages</strong> + cover · ${photoCount} photos<br>Export size ${toUnit(s.width + 2 * s.bleed)} × ${toUnit(s.height + 2 * s.bleed)} ${unit} (trim + bleed)`;

  await ensureFonts(s);
  for (const canvas of $$('#pages canvas')) {
    if (gen !== renderGen) return; // a newer render started
    const id = canvas.dataset.page;
    const page = id === 'front' || id === 'back' ? { type: id } : ps[+id];
    await renderSheet([page], s, { k: k * dpr, bleed: 0, source: previewSource, canvas });
  }
}

$('#pages').addEventListener('click', (e) => {
  const b = e.target.closest('[data-shuffle]');
  if (!b) return;
  const sh = state.project.shuffles;
  sh[b.dataset.shuffle] = (sh[b.dataset.shuffle] || 0) + 1;
  save();
  renderPages();
});

// ---------- Claude ----------
let editingClaude = false;
let inspiration = null; // Blob
let beforeClaude = null; // settings snapshot for undo

function fillClaude() {
  const connected = ai.isConnected();
  $('#claudeSetup').hidden = connected && !editingClaude;
  $('#claudeReady').hidden = !connected || editingClaude;
  $('#c-model').value = ai.getPrefs().model;
  $('#c-cancel').hidden = !connected;
  $('#c-forget').hidden = !connected;
  $('#c-key').placeholder = connected ? 'Saved. Leave blank to keep it' : 'sk-ant-…';
  $('#c-brief').value = state.project.brief || '';
  const has = !!inspiration;
  $('#inspImg').hidden = !has;
  $('#inspEmpty').hidden = has;
  $('#inspRemove').hidden = !has;
}

$('#c-save').addEventListener('click', () => {
  const key = $('#c-key').value.trim();
  if (!key && !ai.isConnected()) return toast('Paste your Claude API key first.');
  if (key && !key.startsWith('sk-ant-')) return toast('That doesn’t look like a Claude API key (it should start with sk-ant-).');
  ai.setPrefs({ ...(key ? { apiKey: key } : {}), model: $('#c-model').value });
  $('#c-key').value = '';
  editingClaude = false;
  fillClaude();
  toast('Claude connected');
});
$('#c-settings').addEventListener('click', () => { editingClaude = true; fillClaude(); });
$('#c-cancel').addEventListener('click', () => { editingClaude = false; fillClaude(); });
$('#c-forget').addEventListener('click', () => {
  ai.setPrefs({ apiKey: '' });
  editingClaude = false;
  fillClaude();
  toast('Key removed from this browser');
});
$('#c-brief').addEventListener('input', (e) => { state.project.brief = e.target.value; save(); });

$('#inspBox').addEventListener('click', () => $('#inspInput').click());
$('#inspInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const { full } = await prepare(f, { maxFull: 1200, thumbSize: 64 });
    inspiration = full;
    await store.setKV('inspiration', full);
    $('#inspImg').src = URL.createObjectURL(full);
    fillClaude();
  } catch {
    toast(/hei[cf]/i.test(f.name) ? 'HEIC images can’t be read here. Use a JPEG or PNG screenshot.' : 'That image couldn’t be read.');
  }
});
$('#inspRemove').addEventListener('click', async () => {
  inspiration = null;
  await store.setKV('inspiration', null);
  fillClaude();
});

function sampleThumbs(n, skip) {
  const pool = state.photos.filter((p) => !state.project.excluded.has(p.id) && !skip.includes(p.id));
  if (pool.length <= n) return pool.map((p) => p.thumb);
  return Array.from({ length: n }, (_, i) => pool[Math.round((i * (pool.length - 1)) / (n - 1))].thumb);
}

$('#c-go').addEventListener('click', async () => {
  const btn = $('#c-go');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spark">✦</span> Claude is designing…';
  $('#c-result').hidden = true;
  try {
    const rs = renderSettings();
    const thumbOf = (id) => state.photos.find((p) => p.id === id)?.thumb || null;
    const { rationale, patch } = await ai.designBook({
      settings: rs,
      groups: groups().map((g) => g.name),
      pageCount: pages().length,
      photoCount: state.photos.length - state.project.excluded.size,
      front: thumbOf(rs.front.photoId),
      back: thumbOf(rs.back.photoId),
      samples: sampleThumbs(8, [rs.front.photoId, rs.back.photoId]),
      inspiration,
      brief: state.project.brief || '',
    });
    beforeClaude = structuredClone(S());
    const cur = S();
    Object.assign(cur, patch, { front: { ...cur.front, ...patch.front }, back: { ...cur.back, ...patch.back } });
    save();
    fillPanel();
    renderPages();
    $('#c-note').textContent = rationale || 'Here’s a new design.';
    $('#c-result').hidden = false;
    $('#c-undo').hidden = false;
  } catch (e) {
    $('#c-note').textContent = e.message;
    $('#c-result').hidden = false;
    $('#c-undo').hidden = true;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="spark">✦</span> Design my book';
  }
});
$('#c-undo').addEventListener('click', () => {
  if (!beforeClaude) return;
  state.project.settings = beforeClaude;
  beforeClaude = null;
  save();
  fillPanel();
  renderPages();
  $('#c-result').hidden = true;
  toast('Back to your previous design');
});

// ---------- Export ----------
const exportPrefs = (() => {
  try { return JSON.parse(localStorage.getItem('photobook-export')) || {}; } catch { return {}; }
})();

$('#exportBtn').addEventListener('click', () => {
  $('#exportChoose').hidden = false;
  $('#exportRun').hidden = true;
  const fmt = exportPrefs.format || 'jpeg';
  $(`#exportChoose input[value=${fmt}]`).checked = true;
  $('#spreadsChk').checked = !!exportPrefs.spreads;
  $('#coversChk').checked = exportPrefs.covers !== false;
  syncSpreadOpt();
  $('#exportDialog').showModal();
});

const chosenFormat = () => $('#exportChoose input[name=format]:checked').value;
function syncSpreadOpt() {
  const jpeg = chosenFormat() === 'jpeg';
  for (const id of ['#spreadOpt', '#coversOpt']) $(id).style.opacity = jpeg ? 1 : 0.4;
  $('#spreadsChk').disabled = $('#coversChk').disabled = !jpeg;
}
$('#exportChoose').addEventListener('change', syncSpreadOpt);

$('#exportChoose').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'go') return;
  e.preventDefault();
  const format = chosenFormat();
  const spreads = $('#spreadsChk').checked;
  const covers = $('#coversChk').checked;
  try { localStorage.setItem('photobook-export', JSON.stringify({ format, spreads, covers })); } catch {}
  Object.assign(exportPrefs, { format, spreads, covers });
  runExport(format, spreads, covers);
});

async function runExport(format, spreads, covers) {
  $('#exportChoose').hidden = true;
  $('#exportRun').hidden = false;
  const isPdf = format === 'pdf';
  $('#exportTitle').textContent = isPdf ? 'Making your PDF…' : 'Making your page images…';
  $('#exportText').textContent = 'Placing photos at print resolution. Keep this tab open.';
  $('#exportBar').style.width = '0';
  $('#exportClose').hidden = true;
  const onProgress = (f) => {
    $('#exportBar').style.width = `${Math.round(f * 100)}%`;
    $('#exportText').textContent = `${isPdf ? 'Placing photos' : 'Rendering pages'}… ${Math.round(f * 100)}%`;
  };
  try {
    let blob;
    if (isPdf) {
      if (!window.PDFLib) throw new Error('PDF library failed to load. Reload the page and try again.');
      blob = await exportPdf(pages(), renderSettings(), { onProgress });
    } else {
      blob = await exportJpegs(pages(), renderSettings(), { spreads, covers, onProgress });
    }
    const clean = (t) => String(t || '').replace(/[\\/:*?"<>|]+/g, '').trim();
    const name = `${clean(S().title) || 'photobook'}${S().subtitle ? ' ' + clean(S().subtitle) : ''}${isPdf ? '.pdf' : spreads ? ' spreads.zip' : ' pages.zip'}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    $('#exportTitle').textContent = isPdf ? 'Your PDF is ready' : 'Your page images are ready';
    $('#exportText').textContent = `Downloaded ${name} (${(blob.size / 1048576).toFixed(1)} MB).${isPdf ? '' : ' Unzip it, then upload each image as a full-page layout, in order.'}`;
  } catch (e) {
    $('#exportTitle').textContent = 'Export failed';
    $('#exportText').textContent = e.message;
  }
  $('#exportClose').hidden = false;
}
$('#exportClose').addEventListener('click', () => $('#exportDialog').close());

// ---------- Boot ----------
await load();
inspiration = (await store.getKV('inspiration')) || null;
if (inspiration) $('#inspImg').src = URL.createObjectURL(inspiration);
gp.preload();
const initial = location.hash.slice(1);
go(['photos', 'groups', 'design'].includes(initial) ? initial : state.photos.length ? 'groups' : 'photos');
