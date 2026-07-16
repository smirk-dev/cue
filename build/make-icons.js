// Generates the Socrates app + tray icons with zero dependencies (Node's zlib only), so
// `npm install` stays clean. Draws the same pinwheel-in-ring mark as the in-app logo.
//
//   node build/make-icons.js   ->   build/icon.png, build/icon.ico, build/tray.png
//
// The .ico embeds PNG-compressed entries (accepted by Windows Vista+ / electron-builder).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x3c, 0x83, 0xf5];        // accent blue, matches --accent in styles.css
const BG2 = [0x2f, 0x6a, 0xd6];       // slightly darker for a soft vertical gradient
const WHITE = [255, 255, 255];

// ---- tiny raster canvas ----
function canvas(n) { return { n, buf: Buffer.alloc(n * n * 4) }; }
function px(c, x, y, rgb, a) {
  if (x < 0 || y < 0 || x >= c.n || y >= c.n) return;
  const i = (y * c.n + x) * 4;
  const ia = 1 - a;
  c.buf[i]   = Math.round(c.buf[i]   * ia + rgb[0] * a);
  c.buf[i+1] = Math.round(c.buf[i+1] * ia + rgb[1] * a);
  c.buf[i+2] = Math.round(c.buf[i+2] * ia + rgb[2] * a);
  c.buf[i+3] = Math.min(255, c.buf[i+3] + Math.round(255 * a));
}

// 4x supersampled coverage of a signed-distance test, for clean anti-aliased edges.
function fill(c, rgb, alpha, inside) {
  const S = 4;
  for (let y = 0; y < c.n; y++) {
    for (let x = 0; x < c.n; x++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        if (inside(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) hit++;
      }
      if (hit) px(c, x, y, rgb, alpha * hit / (S * S));
    }
  }
}

function roundRect(x0, y0, x1, y1, r) {
  return (x, y) => {
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    return dx * dx + dy * dy <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
  };
}
function annulus(cx, cy, rIn, rOut) {
  return (x, y) => { const d = Math.hypot(x - cx, y - cy); return d >= rIn && d <= rOut; };
}
function triangle(ax, ay, bx, by, cx2, cy2) {
  const sign = (px1, py1, px2, py2, px3, py3) => (px1 - px3) * (py2 - py3) - (px2 - px3) * (py1 - py3);
  return (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by);
    const d2 = sign(x, y, bx, by, cx2, cy2);
    const d3 = sign(x, y, cx2, cy2, ax, ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
}

// Draw the emblem at size n. The pinwheel geometry mirrors renderer/icons.js (24-unit space).
function emblem(n, withBg) {
  const c = canvas(n);
  const u = n / 24; // scale from the logo's 24-unit space
  if (withBg) {
    const rr = roundRect(0.5, 0.5, n - 0.5, n - 0.5, n * 0.22);
    // vertical gradient background
    for (let y = 0; y < n; y++) {
      const t = y / n;
      const col = [Math.round(BG[0] * (1 - t) + BG2[0] * t), Math.round(BG[1] * (1 - t) + BG2[1] * t), Math.round(BG[2] * (1 - t) + BG2[2] * t)];
      for (let x = 0; x < n; x++) if (rr(x + 0.5, y + 0.5)) px(c, x, y, col, 1);
    }
  }
  // ring
  fill(c, WHITE, 1, annulus(12 * u, 12 * u, 8.2 * u, 9.9 * u));
  // pinwheel — four quarter triangles from the centre, echoing the logo's opacities
  const P = (x, y) => [x * u, y * u];
  const tris = [
    { p: [P(12, 12), P(6.5, 8.2), P(12, 5.3)], a: 1.0 },
    { p: [P(12, 12), P(15.8, 6.5), P(18.7, 12)], a: 0.72 },
    { p: [P(12, 12), P(17.5, 15.8), P(12, 18.7)], a: 0.5 },
    { p: [P(12, 12), P(8.2, 17.5), P(5.3, 12)], a: 0.85 }
  ];
  for (const t of tris) fill(c, WHITE, t.a, triangle(t.p[0][0], t.p[0][1], t.p[1][0], t.p[1][1], t.p[2][0], t.p[2][1]));
  return c;
}

// ---- PNG encoder ----
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(c) {
  const n = c.n, stride = n * 4;
  const raw = Buffer.alloc((stride + 1) * n);
  for (let y = 0; y < n; y++) { raw[y * (stride + 1)] = 0; c.buf.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- ICO (PNG-compressed entries) ----
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = Buffer.alloc(16 * pngs.length);
  let offset = 6 + 16 * pngs.length;
  pngs.forEach((p, i) => {
    const e = i * 16;
    entries[e] = p.size >= 256 ? 0 : p.size;      // width
    entries[e + 1] = p.size >= 256 ? 0 : p.size;  // height
    entries[e + 2] = 0; entries[e + 3] = 0;
    entries.writeUInt16LE(1, e + 4);              // planes
    entries.writeUInt16LE(32, e + 6);             // bit count
    entries.writeUInt32LE(p.data.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += p.data.length;
  });
  return Buffer.concat([header, entries, ...pngs.map((p) => p.data)]);
}

// ---- emit ----
const outDir = __dirname;
const sizes = [256, 128, 64, 48, 32, 16];
const pngs = sizes.map((size) => ({ size, data: encodePng(emblem(size, true)) }));

fs.writeFileSync(path.join(outDir, 'icon.png'), pngs.find((p) => p.size === 256).data);
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeIco(pngs));
fs.writeFileSync(path.join(outDir, 'tray.png'), encodePng(emblem(32, true)));

console.log('wrote build/icon.png (256), build/icon.ico (' + sizes.join('/') + '), build/tray.png (32)');
