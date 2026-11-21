// Turns a chosen image file into a small square data URL for PUT /api/auth/me/avatar (server limit: 150 KB, jpeg/webp).
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 150 * 1024;
export const AVATAR_PX = 256;
export const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5];
export const TYPES = ['image/webp', 'image/jpeg'];

// Largest centered square inside w x h.
export const cropRect = (w, h) => {
  const side = Math.min(w, h);
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side };
};

// Message to show, or null when the file is acceptable.
export const checkFile = (file) => {
  if (!file || !String(file.type).startsWith('image/')) return 'Please choose an image file (PNG, JPEG, WebP or GIF).';
  if (file.size > MAX_SOURCE_BYTES) return 'That image is over 10 MB. Pick a smaller one.';
  return null;
};

const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

// First blob (webp, then jpeg; quality stepping down) that fits the limit. A browser without webp encoding hands back
// png, which the server rejects, so a type mismatch skips to the next format.
export async function encodeUnderLimit(canvas, maxBytes = MAX_AVATAR_BYTES) {
  for (const type of TYPES) {
    for (const q of QUALITIES) {
      const blob = await toBlob(canvas, type, q);
      if (!blob || blob.type !== type) break;
      if (blob.size <= maxBytes) return blob;
    }
  }
  throw new Error('Could not shrink that image enough. Try a simpler picture.');
}

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('That file could not be read as an image.'));
  img.src = url;
});

const readDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Could not read the resized image.'));
  r.readAsDataURL(blob);
});

export async function fileToAvatarDataUrl(file) {
  const bad = checkFile(file);
  if (bad) throw new Error(bad);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { sx, sy, side } = cropRect(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_PX;
    canvas.height = AVATAR_PX;
    canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
    return await readDataUrl(await encodeUnderLimit(canvas));
  } finally {
    URL.revokeObjectURL(url);
  }
}
