// Claude designs the book's look from your photos, an optional inspiration image and a short brief.
// Calls go straight from the browser to the Claude API with your own key (kept only in this browser).
import { FONTS, FONT_NAMES } from './render.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.5.0/+esm';
const PREFS_KEY = 'photobook-claude';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best design)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest)' },
];

export function getPrefs() {
  try { return { apiKey: '', model: MODELS[0].id, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; } catch { return { apiKey: '', model: MODELS[0].id }; }
}
export function setPrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...getPrefs(), ...p })); } catch {}
}
export const isConnected = () => !!getPrefs().apiKey.trim();

let clientPromise = null, clientKey = null;
async function client() {
  const key = getPrefs().apiKey.trim();
  if (!key) throw new Error('Connect Claude first (add your API key).');
  if (!clientPromise || clientKey !== key) {
    clientKey = key;
    clientPromise = import(SDK_URL).then((m) => {
      const Anthropic = m.default || m.Anthropic;
      return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    });
  }
  return clientPromise;
}

const hex = { type: 'string', description: 'Hex colour like #1d1b18' };
const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rationale', 'title', 'subtitle', 'font', 'titleWeight', 'titleCase', 'titleAlign', 'titleTracking', 'titleScale', 'titleRule',
    'titleMode', 'bg', 'ink', 'accent', 'margin', 'gap', 'radius', 'stroke', 'strokeColor', 'front', 'back'],
  properties: {
    rationale: { type: 'string', description: 'Two or three plain sentences to the book owner explaining the look.' },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    font: { type: 'string', enum: FONT_NAMES },
    titleWeight: { type: 'integer', enum: [400, 600, 700] },
    titleCase: { type: 'string', enum: ['none', 'upper'] },
    titleAlign: { type: 'string', enum: ['center', 'left'] },
    titleTracking: { type: 'number', description: 'Letter spacing in em, 0 to 0.25' },
    titleScale: { type: 'number', description: 'Title size multiplier, 0.7 to 1.6' },
    titleRule: { type: 'boolean', description: 'Short accent-coloured line under group headings' },
    titleMode: { type: 'string', enum: ['header', 'divider', 'none'] },
    bg: hex,
    ink: hex,
    accent: hex,
    margin: { type: 'number', description: 'Page margin in mm' },
    gap: { type: 'number', description: 'Space between photos in mm' },
    radius: { type: 'number', description: 'Photo corner radius in mm' },
    stroke: { type: 'number', description: 'Border drawn inside each photo, in mm (0 for none)' },
    strokeColor: hex,
    front: {
      type: 'object',
      additionalProperties: false,
      required: ['layout', 'titlePos', 'overlay', 'textColor'],
      properties: {
        layout: { type: 'string', enum: ['full', 'framed', 'band', 'inset'] },
        titlePos: { type: 'string', enum: ['top', 'center', 'bottom'] },
        overlay: { type: 'number', description: 'Darkening behind the title on a full-bleed cover, 0 to 0.7' },
        textColor: hex,
      },
    },
    back: {
      type: 'object',
      additionalProperties: false,
      required: ['layout', 'text'],
      properties: {
        layout: { type: 'string', enum: ['full', 'framed', 'small', 'none'] },
        text: { type: 'string', description: 'One short line for the back cover, or empty' },
      },
    },
  },
};

const SYSTEM = `You are an expert photo book designer working inside a small web app that lays out a printed annual family photo book.

How the book is built (you choose the style, the app does the layout):
- Interior pages hold 7 to 10 photos each in justified rows (every photo cropped slightly to fill its cell), separated by "gap" mm, inside a "margin" mm on every side. Photos stay in date order.
- Photos are grouped (usually by month). "titleMode": "header" puts the group name as a heading above the first page of each group; "divider" gives each group its own title page; "none" hides names.
- One font is used for all type. Headings use titleWeight, titleCase, titleTracking (em) and titleScale. Subtitles are small spaced capitals in the same font.
- Front cover layouts: "full" = photo bleeds off every edge with the title over it (titlePos picks top/center/bottom; overlay darkens behind the text; textColor must read clearly on the photo); "framed" = photo inside the margins with the title below on the background colour; "band" = photo fills the top two thirds edge to edge, title in a plain band below; "inset" = smaller centred photo with the title above or below (titlePos top puts the title above).
- Back cover layouts: "full", "framed", "small" (small centred photo with the text line below) or "none" (just the text line). Text on non-full layouts uses "ink" on "bg".
- "radius" rounds photo corners; "stroke" draws a border of strokeColor inside each photo (a white 1–2 mm border gives a print look on darker backgrounds).

Print rules:
- Ranges: margin 6–25 mm, gap 1–8 mm, radius 0–6 mm, stroke 0–3 mm, titleScale 0.7–1.6, titleTracking 0–0.25, overlay 0–0.7.
- Text must have strong contrast with what is behind it. Background colours should flatter photos: usually white, warm off-white, soft neutrals or deep charcoal; avoid saturated backgrounds unless the inspiration clearly calls for them.
- Script fonts (Caveat, Dancing Script) only for short titles; Bebas Neue looks best in its single weight, and uppercase suits it.
- Keep the user's title and subtitle exactly as given unless they are still the app defaults ("Our Year" / the year), in which case you may suggest a short, warm title that fits the photos.

If an inspiration image is provided, match its mood, palette, typography and spacing in spirit (don't copy its words). Otherwise design from the photos themselves and the brief.`;

async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
const imageBlock = async (blob) => ({ type: 'image', source: { type: 'base64', media_type: blob.type || 'image/jpeg', data: await toBase64(blob) } });

// input: { settings, groups:[names], pageCount, photoCount, front, back, samples:[blob], inspiration: blob|null, brief }
export async function designBook(input) {
  const s = input.settings;
  const content = [];
  const facts = [
    `Book: ${s.width} × ${s.height} mm pages, about ${input.pageCount} pages, ${input.photoCount} photos.`,
    `Current title: "${s.title}"  Current subtitle: "${s.subtitle}"`,
    `Groups in order: ${input.groups.join(', ')}.`,
    `Current style: font ${s.font}, background ${s.bg}, text ${s.ink}, front cover layout ${s.front.layout}.`,
  ].join('\n');
  content.push({ type: 'text', text: facts });
  if (input.inspiration) {
    content.push({ type: 'text', text: 'Inspiration image (match its look and feel):' });
    content.push(await imageBlock(input.inspiration));
  }
  if (input.front) {
    content.push({ type: 'text', text: 'Front cover photo:' });
    content.push(await imageBlock(input.front));
  }
  if (input.back) {
    content.push({ type: 'text', text: 'Back cover photo:' });
    content.push(await imageBlock(input.back));
  }
  if (input.samples.length) {
    content.push({ type: 'text', text: `A sample of ${input.samples.length} photos from across the year:` });
    for (const b of input.samples) content.push(await imageBlock(b));
  }
  content.push({ type: 'text', text: input.brief?.trim() ? `What the owner wants: ${input.brief.trim()}` : 'The owner gave no brief; choose a timeless look that suits these photos.' });

  const c = await client();
  const model = getPrefs().model;
  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: DESIGN_SCHEMA } },
  };
  // Opus 5.5 / Sonnet 5.5: if a safety classifier declines, let the API retry on a fallback model.
  if (model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5') {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  let res;
  try {
    res = await c.beta.messages.create(params);
  } catch (e) {
    if (e?.status === 400 && params.fallbacks && /fallback|beta/i.test(e?.message || '')) {
      delete params.fallbacks;
      delete params.betas;
      try { res = await c.beta.messages.create(params); } catch (e2) { throw new Error(friendlyError(e2)); }
    } else {
      throw new Error(friendlyError(e));
    }
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request. Try a different inspiration image or brief.');
  if (res.stop_reason === 'max_tokens') throw new Error('Claude’s reply was cut off. Please try again.');
  const textOut = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return clean(JSON.parse(textOut), s);
  } catch {
    throw new Error('Claude sent back something unexpected. Please try again.');
  }
}

function friendlyError(e) {
  const status = e?.status;
  if (status === 401) return 'The API key was rejected. Check it under Claude settings.';
  if (status === 403) return 'This API key doesn’t have access to that model.';
  if (status === 413) return 'The images were too large to send. Try a smaller inspiration image.';
  if (status === 429) return 'Rate limited by the Claude API. Wait a minute and try again.';
  if (status === 400 && /credit|balance/i.test(e?.message || '')) return 'Your Claude API account is out of credit.';
  if (status >= 500) return 'The Claude API is having trouble right now. Try again shortly.';
  if (!status && /fetch|network|load/i.test(e?.message || '')) return 'Couldn’t reach Claude. Are you online?';
  return e?.message || 'Something went wrong talking to Claude.';
}

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const col = (v, d) => (/^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v) ? '#' + v.slice(1).replace(/./g, '$&$&') : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);

// Validates Claude's answer and returns a partial settings object.
function clean(d, s) {
  const font = pick(d.font, FONT_NAMES, s.font);
  return {
    rationale: String(d.rationale || ''),
    patch: {
      title: String(d.title || s.title).slice(0, 60),
      subtitle: String(d.subtitle ?? s.subtitle).slice(0, 60),
      font,
      titleWeight: pick(+d.titleWeight, FONTS[font].weights, FONTS[font].weights.at(-1)),
      titleCase: pick(d.titleCase, ['none', 'upper'], 'none'),
      titleAlign: pick(d.titleAlign, ['center', 'left'], 'center'),
      titleTracking: num(d.titleTracking, 0, 0.3, 0),
      titleScale: num(d.titleScale, 0.6, 1.8, 1),
      titleRule: !!d.titleRule,
      titleMode: pick(d.titleMode, ['header', 'divider', 'none'], s.titleMode),
      bg: col(d.bg, s.bg),
      ink: col(d.ink, s.ink),
      accent: col(d.accent, s.accent),
      margin: num(d.margin, 4, 30, s.margin),
      gap: num(d.gap, 0, 10, s.gap),
      radius: num(d.radius, 0, 8, 0),
      stroke: num(d.stroke, 0, 4, 0),
      strokeColor: col(d.strokeColor, '#ffffff'),
      front: {
        layout: pick(d.front?.layout, ['full', 'framed', 'band', 'inset'], s.front.layout),
        titlePos: pick(d.front?.titlePos, ['top', 'center', 'bottom'], s.front.titlePos),
        overlay: num(d.front?.overlay, 0, 0.8, s.front.overlay),
        textColor: col(d.front?.textColor, s.front.textColor),
      },
      back: {
        layout: pick(d.back?.layout, ['full', 'framed', 'small', 'none'], s.back.layout),
        text: String(d.back?.text ?? '').slice(0, 80),
      },
    },
  };
}
