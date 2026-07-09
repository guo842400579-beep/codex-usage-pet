const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const source = process.argv[2] || '/Users/bingtang/Downloads/ChatGPT Image 2026年7月9日 14_29_52.png';
const outputDir = path.resolve(__dirname, '..', 'assets', 'rift-hud');
const outputPng = path.join(outputDir, 'frame.png');
const outputMeta = path.join(outputDir, 'frame-metadata.json');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPng(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Unsupported image: expected PNG');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  let srcOffset = 0;
  let prev = Buffer.alloc(stride);
  let scanline = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[srcOffset];
    srcOffset += 1;
    raw.copy(scanline, 0, srcOffset, srcOffset + stride);
    srcOffset += stride;
    unfilter(scanline, prev, filter, channels);

    for (let x = 0; x < width; x += 1) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      rgba[di] = scanline[si];
      rgba[di + 1] = scanline[si + 1];
      rgba[di + 2] = scanline[si + 2];
      rgba[di + 3] = colorType === 6 ? scanline[si + 3] : 255;
    }

    [prev, scanline] = [scanline, prev];
  }

  return { width, height, data: rgba };
}

function unfilter(line, prev, filter, channels) {
  for (let i = 0; i < line.length; i += 1) {
    const left = i >= channels ? line[i - channels] : 0;
    const up = prev[i] || 0;
    const upLeft = i >= channels ? prev[i - channels] || 0 : 0;
    if (filter === 1) {
      line[i] = (line[i] + left) & 255;
    } else if (filter === 2) {
      line[i] = (line[i] + up) & 255;
    } else if (filter === 3) {
      line[i] = (line[i] + Math.floor((left + up) / 2)) & 255;
    } else if (filter === 4) {
      line[i] = (line[i] + paeth(left, up, upLeft)) & 255;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter: ${filter}`);
    }
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function writePng(filePath, image) {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    data.copy(raw, rowOffset + 1, y * stride, y * stride + stride);
  }

  const chunks = [
    chunk('IHDR', makeIhdr(width, height)),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ];
  fs.writeFileSync(filePath, Buffer.concat([PNG_SIGNATURE, ...chunks]));
}

function makeIhdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isWhite(data, i) {
  if (data[i + 3] <= 0) return false;
  const min = Math.min(data[i], data[i + 1], data[i + 2]);
  const max = Math.max(data[i], data[i + 1], data[i + 2]);
  return min > 220 && max - min < 34;
}

function transparent(data, i) {
  data[i] = 0;
  data[i + 1] = 0;
  data[i + 2] = 0;
  data[i + 3] = 0;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function removeWhiteMatte(data, i) {
  const alpha = data[i + 3];
  if (!alpha) return;

  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const chroma = max - min;
  if (min <= 218 || chroma >= 36) return;

  if (min >= 250 && chroma < 18) {
    transparent(data, i);
    return;
  }

  const opacity = Math.max(0, Math.min(1, (255 - min) / 37));
  if (opacity <= 0.04) {
    transparent(data, i);
    return;
  }

  const whiteShare = 1 - opacity;
  data[i] = clampByte((r - 255 * whiteShare) / opacity);
  data[i + 1] = clampByte((g - 255 * whiteShare) / opacity);
  data[i + 2] = clampByte((b - 255 * whiteShare) / opacity);
  data[i + 3] = clampByte(alpha * opacity);
}

function findContentBox(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3] > 0 && !isWhite(image.data, i)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const pad = 8;
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: Math.min(image.width - Math.max(0, minX - pad), maxX - minX + 1 + pad * 2),
    height: Math.min(image.height - Math.max(0, minY - pad), maxY - minY + 1 + pad * 2)
  };
}

function crop(image, box) {
  const data = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const sourceOffset = ((box.y + y) * image.width + box.x) * 4;
    const targetOffset = y * box.width * 4;
    image.data.copy(data, targetOffset, sourceOffset, sourceOffset + box.width * 4);
  }
  return { width: box.width, height: box.height, data };
}

function clearSourceCircle(image, box, cx, cy, radius) {
  for (let y = 0; y < image.height; y += 1) {
    const sy = y + box.y;
    for (let x = 0; x < image.width; x += 1) {
      const sx = x + box.x;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d <= radius) transparent(image.data, (y * image.width + x) * 4);
    }
  }
}

function clearSourceArc(image, box, cx, cy, innerRadius, outerRadius, startDeg, endDeg) {
  for (let y = 0; y < image.height; y += 1) {
    const sy = y + box.y;
    for (let x = 0; x < image.width; x += 1) {
      const sx = x + box.x;
      const dx = sx - cx;
      const dy = sy - cy;
      const radius = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (radius >= innerRadius && radius <= outerRadius && angle >= startDeg && angle <= endDeg) {
        transparent(image.data, (y * image.width + x) * 4);
      }
    }
  }
}

function clearSourceRect(image, box, x, y, width, height) {
  const startX = Math.max(0, x - box.x);
  const startY = Math.max(0, y - box.y);
  const endX = Math.min(image.width, startX + width);
  const endY = Math.min(image.height, startY + height);
  for (let yy = startY; yy < endY; yy += 1) {
    for (let xx = startX; xx < endX; xx += 1) {
      transparent(image.data, (yy * image.width + xx) * 4);
    }
  }
}

function main() {
  const input = readPng(source);
  const box = findContentBox(input);
  const frame = crop(input, box);

  for (let i = 0; i < frame.data.length; i += 4) {
    removeWhiteMatte(frame.data, i);
  }

  const portrait = { cx: 307, cy: 376, radius: 190 };

  fs.mkdirSync(outputDir, { recursive: true });
  writePng(outputPng, frame);
  fs.writeFileSync(outputMeta, `${JSON.stringify({
    source,
    sourceSize: { width: input.width, height: input.height },
    crop: box,
    frameSize: { width: frame.width, height: frame.height },
    regions: {
      portrait: toFrameCircle(box, portrait),
      xpArc: {
        center: toFramePoint(box, portrait.cx, portrait.cy),
        innerRadius: 240,
        outerRadius: 294,
        startDeg: -54,
        endDeg: 54
      },
      healthBar: toFrameRect(box, 616, 481, 1250, 38),
      manaBar: toFrameRect(box, 616, 544, 1250, 37),
      bubbleArea: toFrameRect(box, 578, 181, 1292, 272)
    }
  }, null, 2)}\n`);
  console.log(`wrote ${outputPng}`);
  console.log(`wrote ${outputMeta}`);
}

function toFramePoint(box, x, y) {
  return { x: x - box.x, y: y - box.y };
}

function toFrameCircle(box, circle) {
  return { ...toFramePoint(box, circle.cx, circle.cy), radius: circle.radius };
}

function toFrameRect(box, x, y, width, height) {
  return { x: x - box.x, y: y - box.y, width, height };
}

main();
