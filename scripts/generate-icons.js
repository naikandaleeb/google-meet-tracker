const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    table[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(width, height, getPixelRgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Scanlines with filter 0
  const rowBytes = width * 4;
  const rawData = Buffer.alloc(height * (rowBytes + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixelRgba(x, y, width, height);
      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function drawIcon(size) {
  return createPng(size, size, (x, y, w, h) => {
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = w * 0.44;

    // Outer circle / badge
    if (dist > radius) {
      // Subtle anti-aliasing edge
      if (dist < radius + 1) {
        const alpha = Math.max(0, Math.min(255, Math.floor((radius + 1 - dist) * 255)));
        return [124, 92, 255, alpha];
      }
      return [0, 0, 0, 0];
    }

    // Inside badge: dark Akatsuki gradient with Rinnegan purple ring
    const ringDist = Math.abs(dist - radius * 0.78);
    if (ringDist < radius * 0.09) {
      return [124, 92, 255, 255]; // Neon Purple ring
    }

    // Central camera / study glyph
    // Draw camera box in center
    const boxW = w * 0.38;
    const boxH = h * 0.28;
    const inBox = Math.abs(dx) <= boxW / 2 && Math.abs(dy - h * 0.04) <= boxH / 2;

    // Camera lens circle
    const lensRadius = w * 0.12;
    const lensDist = Math.sqrt(dx * dx + (dy - h * 0.04) * (dy - h * 0.04));
    if (lensDist <= lensRadius) {
      if (lensDist <= lensRadius * 0.45) {
        return [0, 255, 136, 255]; // Bright green lens pupil (Active camera / cockroach eye)
      }
      return [10, 10, 18, 255]; // Inner ring
    }

    if (inBox) {
      return [192, 40, 45, 255]; // Akatsuki Crimson camera body
    }

    // Background fill (Dark Void Black gradient)
    const factor = dist / radius;
    const r = Math.floor(15 + 20 * factor);
    const g = Math.floor(12 + 15 * factor);
    const b = Math.floor(25 + 40 * factor);
    return [r, g, b, 255];
  });
}

const outDir = path.join(__dirname, '..', 'extension', 'icons');
[16, 48, 128].forEach(size => {
  const buf = drawIcon(size);
  const target = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(target, buf);
  console.log(`Generated ${target} (${buf.length} bytes)`);
});
