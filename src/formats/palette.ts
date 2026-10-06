import { requireTag } from './tagged';

/** 256-entry RGBA palette. Index 0 is transparent. */
export type Palette = Uint8Array; // length 256 * 4

/** .PAL files hold a "VGA:" chunk of 6-bit-per-channel RGB triples. */
export function parsePalette(bytes: Uint8Array): Palette {
  const vga = requireTag(bytes, 'VGA:');
  const count = Math.min(256, Math.floor(vga.length / 3));
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      // Scale 0..63 to 0..255 exactly (x<<2 | x>>4) rather than plain <<2.
      const v = vga[i * 3 + c]! & 0x3f;
      out[i * 4 + c] = (v << 2) | (v >> 4);
    }
    out[i * 4 + 3] = i === 0 ? 0 : 255;
  }
  return out;
}

/** Fallback greyscale palette for viewing images with no known palette. */
export function greyscalePalette(): Palette {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out.set([i, i, i, i === 0 ? 0 : 255], i * 4);
  }
  return out;
}
