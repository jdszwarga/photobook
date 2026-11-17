// IndexedDB storage: photo files (full + thumbnail) and the project JSON.
const DB_NAME = 'photobook';
let dbp;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('photos', { keyPath: 'id' });
      d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const putPhoto = (p) => tx('photos', 'readwrite', (s) => s.put(p));
export const getPhoto = (id) => tx('photos', 'readonly', (s) => s.get(id));
export const deletePhoto = (id) => tx('photos', 'readwrite', (s) => s.delete(id));
export const hasPhoto = async (id) => (await tx('photos', 'readonly', (s) => s.count(id))) > 0;

// Metadata only (no blobs) for every photo.
export async function allPhotoMeta() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = d.transaction('photos').objectStore('photos').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      const { full, ...meta } = c.value;
      out.push(meta);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export const getKV = (k) => tx('kv', 'readonly', (s) => s.get(k));
export const setKV = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));

export async function clearAll() {
  await tx('photos', 'readwrite', (s) => s.clear());
  await tx('kv', 'readwrite', (s) => s.clear());
}
