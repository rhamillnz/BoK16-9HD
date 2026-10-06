import { decompress, decompressLZW, decompressRLE, Compression } from './compression';
import { Reader } from './reader';
import { requireTag } from './tagged';

/** Paletted image: one byte per pixel, row-major. */
export interface IndexedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const FLAG_XY_SWAPPED = 0x20;
const FLAG_RLE = 0x80;

const SIG_NORMAL = 0x1066;
const SIG_TAGGED = 0x4d42; // "BM"

/**
 * .BMX image sets. Two layouts exist:
 *  - 0x1066: header + per-image table, then one compressed blob holding all images.
 *  - "BM":  tagged INF:/BIN: chunks with 4-bit packed pixels (used for hi-res UI art).
 */
export function parseBMX(bytes: Uint8Array): IndexedImage[] {
  const r = new Reader(bytes);
  const sig = r.u16();
  if (sig === SIG_NORMAL) return parseNormal(r);
  if (sig === SIG_TAGGED) return parseTagged(bytes);
  throw new Error(`unknown BMX signature 0x${sig.toString(16)}`);
}

function parseNormal(r: Reader): IndexedImage[] {
  const compression = r.u16();
  const count = r.u16();
  r.skip(2);
  let total = r.u32();

  const headers: { size: number; flags: number; width: number; height: number }[] = [];
  for (let i = 0; i < count; i++) {
    headers.push({ size: r.u16(), flags: r.u16(), width: r.u16(), height: r.u16() });
  }

  // The stored total under-reports for LZSS; reserve extra and let the decoder stop at input end.
  if (compression === Compression.LZSS) total *= 2;
  const blob = decompress(compression, r.bytes.subarray(r.pos), total);

  const images: IndexedImage[] = [];
  let p = 0;
  for (const h of headers) {
    const chunk = blob.subarray(p, p + h.size);
    p += h.size;
    images.push(decodeImage(chunk, h.width, h.height, h.flags));
  }
  return images;
}

function decodeImage(chunk: Uint8Array, width: number, height: number, flags: number): IndexedImage {
  const n = width * height;
  const raw = flags & FLAG_RLE ? decompressRLE(chunk, n).data : chunk;
  const pixels = new Uint8Array(n);
  if (flags & FLAG_XY_SWAPPED) {
    // Stored column-major.
    let i = 0;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) pixels[y * width + x] = raw[i++] ?? 0;
    }
  } else {
    pixels.set(raw.subarray(0, n));
  }
  return { width, height, pixels };
}

function parseTagged(bytes: Uint8Array): IndexedImage[] {
  const inf = new Reader(requireTag(bytes, 'INF:'));
  const count = inf.u16();
  // INF: count, then count widths, then count heights.
  const widths: number[] = [];
  for (let i = 0; i < count; i++) widths.push(inf.u16());
  const heights: number[] = [];
  for (let i = 0; i < count; i++) heights.push(inf.u16());

  const bin = new Reader(requireTag(bytes, 'BIN:'));
  bin.u8(); // compression (always LZW in practice)
  const size = bin.u32();
  const blob = decompressLZW(bin.bytes.subarray(bin.pos), size);

  const images: IndexedImage[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    const width = widths[i]!;
    const height = heights[i]!;
    const pixels = new Uint8Array(width * height);
    // Two 4-bit pixels per byte, high nibble first; rows are byte-aligned.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x += 2) {
        const b = blob[p++] ?? 0;
        pixels[y * width + x] = b >> 4;
        if (x + 1 < width) pixels[y * width + x + 1] = b & 0x0f;
      }
    }
    images.push({ width, height, pixels });
  }
  return images;
}

/** Expand an indexed image to RGBA using a palette. */
export function toRGBA(img: IndexedImage, palette: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < img.pixels.length; i++) {
    const c = img.pixels[i]! * 4;
    out[i * 4] = palette[c]!;
    out[i * 4 + 1] = palette[c + 1]!;
    out[i * 4 + 2] = palette[c + 2]!;
    out[i * 4 + 3] = palette[c + 3]!;
  }
  return out;
}
