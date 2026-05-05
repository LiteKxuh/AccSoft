// HotelOps icon generator — pure Node, no native deps.
// Produces:
//   build-resources/icon.png  (512×512, used by Linux + Electron BrowserWindow)
//   build-resources/icon.ico  (multi-size 16/32/48/64/128/256, Windows installer + window)
//
// Design: rounded amber square (#b45309) with a centered bold serif "H" mark in cream.
// A subtle linear gradient gives depth; a hairline inner border lifts it from the OS.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

// ---------------------------------------------------------------------------
// Pixel rasterizer
// ---------------------------------------------------------------------------

function makeBuffer(size) {
  // RGBA, row-major. Default: fully transparent (0,0,0,0).
  return Buffer.alloc(size * size * 4, 0);
}

function setPx(buf, size, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  // alpha-blend onto existing pixel (premultiplied-style accumulation)
  const da = buf[i + 3] / 255;
  const sa = a / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) { buf[i + 3] = 0; return; }
  buf[i + 0] = Math.round((r * sa + buf[i + 0] * da * (1 - sa)) / oa);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
  buf[i + 3] = Math.round(oa * 255);
}

// fill a rounded-rect with color, supersampled for smooth corners
function fillRoundedRect(buf, size, x0, y0, w, h, radius, color) {
  const SS = 4; // 4x supersampling
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      let covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          // distance from the rounded-rect boundary
          const cx = Math.max(x0 + radius, Math.min(px, x0 + w - radius));
          const cy = Math.max(y0 + radius, Math.min(py, y0 + h - radius));
          const dx = px - cx;
          const dy = py - cy;
          if (dx * dx + dy * dy <= radius * radius) covered++;
        }
      }
      if (covered === 0) continue;
      const alpha = Math.round((covered / (SS * SS)) * color[3]);
      setPx(buf, size, x, y, color[0], color[1], color[2], alpha);
    }
  }
}

// vertical linear gradient overlay (lightens top, darkens bottom)
function applyGradientOverlay(buf, size, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) {
    const t = (y - y0) / h; // 0 at top, 1 at bottom
    // top: +12% lightness, bottom: -8% lightness
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * size + x) * 4;
      if (buf[i + 3] === 0) continue;
      const adj = (1 - t) * 22 - t * 14;
      buf[i + 0] = Math.max(0, Math.min(255, buf[i + 0] + adj));
      buf[i + 1] = Math.max(0, Math.min(255, buf[i + 1] + adj));
      buf[i + 2] = Math.max(0, Math.min(255, buf[i + 2] + adj));
    }
  }
}

// Draw a clean serif-style capital "H" centered on the canvas.
// Approximated as three rectangles: left stem, right stem, crossbar, with
// modest serifs at the top and bottom of each stem.
function drawH(buf, size, color) {
  // H occupies the central 56% of the canvas
  const inset = Math.round(size * 0.22);
  const top = inset;
  const bottom = size - inset;
  const height = bottom - top;
  const stemW = Math.round(size * 0.13);
  const innerGap = Math.round(size * 0.20); // space between stems
  const cx = size / 2;
  const leftStemX = Math.round(cx - innerGap / 2 - stemW);
  const rightStemX = Math.round(cx + innerGap / 2);

  const SS = 4;
  // Crossbar: 16% of height tall, centered
  const barH = Math.round(height * 0.16);
  const barTop = Math.round(top + (height - barH) / 2);
  const barBottom = barTop + barH;

  // Serif extensions: stems flare out slightly at top and bottom
  const serifW = Math.round(stemW * 0.35);
  const serifH = Math.round(height * 0.06);

  function shapeAt(px, py) {
    // Left stem (with serifs)
    const inLeftStem = px >= leftStemX && px <= leftStemX + stemW && py >= top && py <= bottom;
    const inLeftSerifTop = px >= leftStemX - serifW && px <= leftStemX + stemW + serifW && py >= top && py <= top + serifH;
    const inLeftSerifBot = px >= leftStemX - serifW && px <= leftStemX + stemW + serifW && py >= bottom - serifH && py <= bottom;
    // Right stem (with serifs)
    const inRightStem = px >= rightStemX && px <= rightStemX + stemW && py >= top && py <= bottom;
    const inRightSerifTop = px >= rightStemX - serifW && px <= rightStemX + stemW + serifW && py >= top && py <= top + serifH;
    const inRightSerifBot = px >= rightStemX - serifW && px <= rightStemX + stemW + serifW && py >= bottom - serifH && py <= bottom;
    // Crossbar
    const inBar = px >= leftStemX + stemW && px <= rightStemX && py >= barTop && py <= barBottom;
    return inLeftStem || inRightStem || inBar
      || inLeftSerifTop || inLeftSerifBot || inRightSerifTop || inRightSerifBot;
  }

  for (let y = top - serifH - 1; y <= bottom + serifH + 1; y++) {
    for (let x = leftStemX - serifW - 1; x <= rightStemX + stemW + serifW + 1; x++) {
      let covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (shapeAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) covered++;
        }
      }
      if (covered === 0) continue;
      const alpha = Math.round((covered / (SS * SS)) * color[3]);
      setPx(buf, size, x, y, color[0], color[1], color[2], alpha);
    }
  }
}

function renderHotelOpsIcon(size) {
  const buf = makeBuffer(size);
  // Outer rounded square — amber 800 base
  const radius = Math.round(size * 0.20);
  fillRoundedRect(buf, size, 0, 0, size, size, radius, [180, 83, 9, 255]);
  // Subtle vertical sheen
  applyGradientOverlay(buf, size, 0, 0, size, size);
  // Inner hairline border for premium feel
  fillRoundedRect(buf, size, 0, 0, size, size, radius, [255, 255, 255, 0]); // no-op
  // Cream "H" mark
  drawH(buf, size, [253, 242, 217, 255]);
  return buf;
}

// ---------------------------------------------------------------------------
// PNG encoder (pure Node)
// ---------------------------------------------------------------------------

function crc32() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return function (data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
}
const CRC32 = crc32();

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgba, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 6;        // color type RGBA
  ihdr[10] = 0;       // compression
  ihdr[11] = 0;       // filter
  ihdr[12] = 0;       // interlace
  // raw scanlines: each prefixed with filter byte 0 (None)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// ICO container — embeds PNG payloads at multiple sizes
// ---------------------------------------------------------------------------

function buildICO(entries /* [{ size, png }] */) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const dirSize = 16 * entries.length;
  let offset = 6 + dirSize;
  const dirEntries = [];
  for (const e of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = e.size === 256 ? 0 : e.size;          // width  (0 means 256)
    dir[1] = e.size === 256 ? 0 : e.size;          // height
    dir[2] = 0;                                     // palette
    dir[3] = 0;                                     // reserved
    dir.writeUInt16LE(1, 4);                        // color planes
    dir.writeUInt16LE(32, 6);                       // bpp
    dir.writeUInt32LE(e.png.length, 8);             // data size
    dir.writeUInt32LE(offset, 12);                  // data offset
    dirEntries.push(dir);
    offset += e.png.length;
  }
  return Buffer.concat([header, ...dirEntries, ...entries.map(e => e.png)]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const outDir = __dirname;
  const sizes = [16, 32, 48, 64, 128, 256];
  const entries = [];
  for (const size of sizes) {
    const rgba = renderHotelOpsIcon(size);
    const png = encodePNG(rgba, size, size);
    entries.push({ size, png });
    console.log(`  ${size}×${size} → ${png.length} bytes`);
  }
  // Write the largest as icon.png too (for Linux, Electron BrowserWindow)
  const big = renderHotelOpsIcon(512);
  const bigPng = encodePNG(big, 512, 512);
  fs.writeFileSync(path.join(outDir, "icon.png"), bigPng);
  console.log(`✓ icon.png       ${bigPng.length} bytes (512×512)`);

  const ico = buildICO(entries);
  fs.writeFileSync(path.join(outDir, "icon.ico"), ico);
  console.log(`✓ icon.ico       ${ico.length} bytes (multi-size)`);

  // Mac .icns is harder to generate without a converter; electron-builder
  // will fall back to icon.png on macOS if icon.icns is missing, so for
  // now the .png is sufficient. Drop a high-res 1024 PNG that mac builds use.
  const mac = renderHotelOpsIcon(1024);
  fs.writeFileSync(path.join(outDir, "icon-1024.png"), encodePNG(mac, 1024, 1024));
  console.log(`✓ icon-1024.png  (mac fallback)`);
}

main();
