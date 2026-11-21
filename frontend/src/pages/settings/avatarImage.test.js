import { MAX_AVATAR_BYTES, cropRect, checkFile, encodeUnderLimit } from './avatarImage';

const canvasWith = (sizes) => {
  const calls = [];
  return { calls, toBlob: (cb, type, q) => { calls.push([type, q]); const s = sizes[type]?.shift(); cb(s === undefined ? null : { type, size: s }); } };
};

test('cropRect centers the largest square', () => {
  expect(cropRect(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 });
  expect(cropRect(100, 300)).toEqual({ sx: 0, sy: 100, side: 100 });
});

test('checkFile rejects non-images and files over 10 MB', () => {
  expect(checkFile({ type: 'application/pdf', size: 10 })).toMatch(/image/);
  expect(checkFile({ type: 'image/png', size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
  expect(checkFile({ type: 'image/png', size: 1000 })).toBeNull();
});

test('encodeUnderLimit steps quality down until the blob fits', async () => {
  const c = canvasWith({ 'image/webp': [MAX_AVATAR_BYTES + 1, MAX_AVATAR_BYTES + 1, 1000] });
  const blob = await encodeUnderLimit(c);
  expect(blob.size).toBe(1000);
  expect(c.calls.map(([, q]) => q)).toEqual([0.9, 0.8, 0.7]);
});

test('encodeUnderLimit falls back to jpeg when webp is unsupported, and gives up when nothing fits', async () => {
  const big = MAX_AVATAR_BYTES + 1;
  const c = canvasWith({ 'image/jpeg': [big, 500] });
  expect((await encodeUnderLimit(c)).type).toBe('image/jpeg');
  await expect(encodeUnderLimit(canvasWith({ 'image/webp': Array(5).fill(big), 'image/jpeg': Array(5).fill(big) }))).rejects.toThrow(/shrink/);
});
