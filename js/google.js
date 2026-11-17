// Google Photos Picker API: sign-in, picking session, listing and downloading.
import { GOOGLE_CLIENT_ID, PROXY_URL } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const API = 'https://photospicker.googleapis.com/v1';
let token = null; // { value, expires }
let tokenClient = null;
let pending = null; // { resolve, reject } for the sign-in in progress

export const isConfigured = () => !!GOOGLE_CLIENT_ID;
export const hasToken = () => token && token.expires > Date.now() + 60_000;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.append(s);
  });
}

export async function preload() {
  if (isConfigured()) await loadGis().catch(() => {});
}

// Must be called from a click handler (opens Google's sign-in popup).
export function signIn() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) return reject(new Error('Google sign-in is still loading, try again'));
    pending = { resolve, reject };
    tokenClient ??= google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return pending?.reject(new Error(r.error_description || r.error));
        token = { value: r.access_token, expires: Date.now() + (r.expires_in - 30) * 1000 };
        pending?.resolve();
      },
      error_callback: (e) => pending?.reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed' : e.message || e.type || 'Sign-in failed')),
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!r.ok) throw new Error(`Google Photos error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

const secs = (d) => parseFloat(d) || 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// win: a window opened synchronously in the click handler (avoids popup blockers).
// Resolves with the picked items: [{ id, createTime, filename, mimeType, width, height, baseUrl }]
export async function pick(win, { onStatus, signal } = {}) {
  const session = await api('/sessions', { method: 'POST', body: '{}' });
  if (win && !win.closed) win.location.href = session.pickerUri + '/autoclose';
  else window.open(session.pickerUri + '/autoclose', '_blank');
  onStatus?.('Choose photos in the Google Photos window, then press Done.');

  let s = session;
  const deadline = Date.now() + secs(session.pollingConfig?.timeoutIn || '1800s') * 1000;
  while (!s.mediaItemsSet) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (Date.now() > deadline) throw new Error('The Google Photos window timed out. Try again.');
    await sleep(secs(s.pollingConfig?.pollInterval || session.pollingConfig?.pollInterval) * 1000);
    s = await api(`/sessions/${session.id}`);
  }

  onStatus?.('Reading your selection…');
  const items = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ sessionId: session.id, pageSize: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await api(`/mediaItems?${q}`);
    for (const m of r.mediaItems || []) {
      if (m.type && m.type !== 'PHOTO') continue;
      items.push({
        id: m.id,
        createTime: m.createTime,
        filename: m.mediaFile?.filename || '',
        mimeType: m.mediaFile?.mimeType || '',
        width: m.mediaFile?.mediaFileMetadata?.width,
        height: m.mediaFile?.mediaFileMetadata?.height,
        baseUrl: m.mediaFile.baseUrl,
      });
    }
    pageToken = r.nextPageToken;
  } while (pageToken);

  api(`/sessions/${session.id}`, { method: 'DELETE' }).catch(() => {});
  return items;
}

let useProxy = false;

// Downloads a JPEG rendition (Google converts HEIC to JPEG for sized requests).
export async function download(item, size = 2560) {
  const url = `${item.baseUrl}=w${size}-h${size}`;
  const auth = { Authorization: `Bearer ${token.value}` };
  if (!useProxy) {
    try {
      const r = await fetch(url, { headers: auth });
      if (!r.ok) throw new Error(`Download failed (${r.status})`);
      return await r.blob();
    } catch (e) {
      if (!(e instanceof TypeError) || !PROXY_URL) {
        if (e instanceof TypeError) throw new Error('The browser blocked the download from Google. Set up the download proxy (README → "If downloads are blocked").');
        throw e;
      }
      useProxy = true; // network/CORS error: switch to the proxy for the rest of the session
    }
  }
  const r = await fetch(PROXY_URL, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  if (!r.ok) throw new Error(`Download via proxy failed (${r.status})`);
  return r.blob();
}
