// Generates branded placeholder PNG icons with zero dependencies.
// Draws a dumbbell mark on a vertical orange gradient.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../public");
mkdirSync(OUT, { recursive: true });

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Build RGBA pixel buffer for one icon.
function render(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4);
  const top = [249, 115, 22]; // #f97316
  const bot = [234, 88, 12]; // #ea580c
  const white = [255, 255, 255];

  const inset = maskable ? Math.round(size * 0.0) : 0; // full-bleed bg either way
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  };

  // Background gradient
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const col = [lerp(top[0], bot[0], t), lerp(top[1], bot[1], t), lerp(top[2], bot[2], t)];
    for (let x = 0; x < size; x++) set(x, y, col);
  }

  // Dumbbell geometry (keep within safe area for maskable: ~80% center)
  const s = maskable ? 0.62 : 0.74; // overall scale of mark
  const cx = size / 2;
  const cy = size / 2;
  const half = (size * s) / 2;

  const barH = size * 0.10 * (s / 0.74);
  const barX0 = cx - half * 0.62;
  const barX1 = cx + half * 0.62;
  const plateW = half * 0.20;
  const innerPlateH = half * 0.95;
  const outerPlateH = half * 0.62;

  const rect = (x0, x1, y0, y1) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) set(x, y, white);
  };

  // center bar
  rect(barX0, barX1, cy - barH / 2, cy + barH / 2);
  // left inner + outer plates
  rect(cx - half, cx - half + plateW, cy - outerPlateH / 2, cy + outerPlateH / 2);
  rect(cx - half + plateW * 1.25, cx - half + plateW * 2.25, cy - innerPlateH / 2, cy + innerPlateH / 2);
  // right inner + outer plates
  rect(cx + half - plateW, cx + half, cy - outerPlateH / 2, cy + outerPlateH / 2);
  rect(cx + half - plateW * 2.25, cx + half - plateW * 1.25, cy - innerPlateH / 2, cy + innerPlateH / 2);

  return buf;
}

// Minimal PNG encoder (truecolor + alpha, 8-bit).
function encodePNG(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const targets = [
  { file: "pwa-192x192.png", size: 192, maskable: false },
  { file: "pwa-512x512.png", size: 512, maskable: false },
  { file: "pwa-maskable-192x192.png", size: 192, maskable: true },
  { file: "pwa-maskable-512x512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: true },
  { file: "favicon-32.png", size: 32, maskable: false },
];

for (const t of targets) {
  const png = encodePNG(t.size, render(t.size, { maskable: t.maskable }));
  writeFileSync(path.join(OUT, t.file), png);
  console.log("wrote", t.file, png.length, "bytes");
}
