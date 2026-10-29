// Generates public/icon/{16,32,48,128}.png: a red rounded square with a white
// "summary lines" glyph. No dependencies; run with `node scripts/make-icons.mjs`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

function icon(size) {
  const ss = 4; // supersampling for anti-aliased edges
  const r = size * 0.22;
  const inRoundedRect = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // Three horizontal bars of decreasing length.
  const bars = [
    [0.22, 0.3, 0.78],
    [0.22, 0.47, 0.78],
    [0.22, 0.64, 0.58],
  ];
  const barH = 0.1;
  const inBar = (x, y) =>
    bars.some(([x0, y0, x1]) => x >= x0 * size && x <= x1 * size && y >= y0 * size && y <= (y0 + barH) * size);

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss, py = y + (sy + 0.5) / ss;
          if (inRoundedRect(px, py)) inBar(px, py) ? fg++ : bg++;
        }
      const n = ss * ss, a = (bg + fg) / n, f = fg / Math.max(1, bg + fg);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(0xc4 + (0xff - 0xc4) * f);
      raw[o + 1] = Math.round(0x30 + (0xff - 0x30) * f);
      raw[o + 2] = Math.round(0x2b + (0xff - 0x2b) * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../public/icon/', import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`../public/icon/${size}.png`, import.meta.url), icon(size));
