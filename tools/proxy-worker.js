// Optional Cloudflare Worker: only needed if the browser can't download photos
// from Google directly (a CORS block). It forwards one request to Google's photo
// host with your sign-in token and returns the image. It stores nothing.
//
// Deploy: Cloudflare dashboard → Workers → Create → paste this file → Deploy.
// Then put the worker URL in js/config.js as PROXY_URL.

const ALLOWED_ORIGINS = ['https://jdszwarga.github.io', 'http://localhost:5180'];

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST' || !ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403, headers: cors });

    const { url } = await req.json().catch(() => ({}));
    let target;
    try { target = new URL(url); } catch { return new Response('Bad url', { status: 400, headers: cors }); }
    if (target.protocol !== 'https:' || !target.hostname.endsWith('.googleusercontent.com')) {
      return new Response('Only Google Photos URLs are allowed', { status: 400, headers: cors });
    }
    const r = await fetch(target, { headers: { Authorization: req.headers.get('Authorization') || '' } });
    return new Response(r.body, {
      status: r.status,
      headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'no-store' },
    });
  },
};
