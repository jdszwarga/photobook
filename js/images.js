// Decoding, thumbnails and EXIF dates.

export async function decode(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Fallback through <img> (some browsers only decode certain formats this way).
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encode failed'))), type, quality));
}

// Returns { thumb, full, width, height } where full is re-encoded to JPEG if needed.
export async function prepare(blob, { maxFull = 2560, thumbSize = 480 } = {}) {
  const bmp = await decode(blob);
  const w = bmp.width, h = bmp.height;
  let full = blob;
  const scaleFull = Math.min(1, maxFull / Math.max(w, h));
  if (blob.type !== 'image/jpeg' || scaleFull < 1) full = await resizeTo(bmp, scaleFull, 0.92);
  const thumb = await resizeTo(bmp, Math.min(1, thumbSize / Math.max(w, h)), 0.82);
  bmp.close?.();
  return { full, thumb, width: w, height: h };
}

async function resizeTo(bmp, scale, quality) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', quality);
}

// EXIF DateTimeOriginal from a JPEG (local file import). Returns ISO string or null.
export async function exifDate(file) {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off < buf.byteLength - 4) {
      const marker = buf.getUint16(off);
      const len = buf.getUint16(off + 2);
      if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) return parseTiff(buf, off + 10);
      off += 2 + len;
    }
  } catch {}
  return null;
}

function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const readStr = (o, n) => {
    let s = '';
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };
  const findTag = (ifd, tag) => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === tag) return e;
    }
    return null;
  };
  const ifd0 = u32(4);
  let dateStr = null;
  const exifPtr = findTag(ifd0, 0x8769);
  if (exifPtr) {
    const exif = u32(exifPtr + 8);
    const e = findTag(exif, 0x9003) ?? findTag(exif, 0x9004);
    if (e) dateStr = readStr(u32(e + 8), 20);
  }
  if (!dateStr) {
    const e = findTag(ifd0, 0x0132);
    if (e) dateStr = readStr(u32(e + 8), 20);
  }
  const m = dateStr?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString();
}
