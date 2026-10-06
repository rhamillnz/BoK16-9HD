import { decompressRLE } from './compression';
import type { IndexedImage } from './bmx';
import { Reader } from './reader';
import { requireTag } from './tagged';

/** `version` byte of a monochrome 1bpp font (most .FNT files). */
export const FNT_VERSION_MONO = 0xff;
/** `version` byte of the 8bpp shaded font (SPELL.FNT). */
export const FNT_VERSION_SHADED = 0xfd;

/** One character cell. `pixels` is width*height, row-major, top row first; 0 = transparent. */
export interface Glyph {
  /** Character code this glyph draws (firstChar + index). */
  code: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface Font {
  version: number;
  maxWidth: number;
  height: number;
  baseline: number;
  firstChar: number;
  glyphs: Glyph[];
}

/**
 * Parse the "FNT:" chunk of a .FNT file.
 *
 * Chunk header: u8 version, maxWidth, height, baseline, firstChar, numChars; u16 dataLength;
 * u8 compression (must be 1, RLE); u32 decompressed size. The RLE payload decodes to
 * u16 offsets[numChars], u8 widths[numChars], then glyph bitmaps at
 * (start of widths + numChars + offsets[i]).
 */
export function parseFNT(bytes: Uint8Array): Font {
  const chunk = requireTag(bytes, 'FNT:');
  const r = new Reader(chunk);
  const version = r.u8();
  const maxWidth = r.u8();
  const height = r.u8();
  const baseline = r.u8();
  const firstChar = r.u8();
  const numChars = r.u8();
  r.u16(); // dataLength (compressed size); not needed
  const compression = r.u8();
  if (compression !== 0x01) throw new Error(`FNT: expected RLE compression marker 0x01, got ${compression}`);
  const size = r.u32();
  if (version !== FNT_VERSION_MONO && version !== FNT_VERSION_SHADED) {
    throw new Error(`FNT: unexpected font version 0x${version.toString(16)}`);
  }
  if (height > 16 && version === FNT_VERSION_MONO) throw new Error(`FNT: mono glyph height ${height} exceeds 16`);

  const { data } = decompressRLE(chunk, size, r.pos);
  const d = new Reader(data);
  const offsets: number[] = [];
  for (let i = 0; i < numChars; i++) offsets.push(d.u16());
  const widthsStart = d.pos;
  const glyphsStart = widthsStart + numChars;

  const glyphs: Glyph[] = [];
  for (let i = 0; i < numChars; i++) {
    const width = data[widthsStart + i];
    if (width === undefined) throw new RangeError('FNT: width table past end of data');
    const g = new Reader(data, glyphsStart + offsets[i]!);
    const pixels = new Uint8Array(width * height);
    if (version === FNT_VERSION_MONO) {
      for (let y = 0; y < height; y++) {
        let row = g.u8() << 8;
        if (width > 8) row |= g.u8();
        for (let x = 0; x < width; x++) pixels[y * width + x] = row & (0x8000 >> x) ? 1 : 0;
      }
    } else {
      for (let i2 = 0; i2 < pixels.length; i2++) pixels[i2] = g.u8();
    }
    glyphs.push({ code: firstChar + i, width, height, pixels });
  }
  return { version, maxWidth, height, baseline, firstChar, glyphs };
}

/**
 * Glyph for a character code. Codes outside the font fall back to the first glyph
 * (the original engine does the same for codes below firstChar).
 */
export function glyphFor(font: Font, code: number): Glyph {
  return font.glyphs[code - font.firstChar] ?? font.glyphs[0]!;
}

/** Pixel width of `text` on one line (sum of glyph widths plus `spacing` between glyphs). */
export function measureString(font: Font, text: string, spacing = 0): number {
  let w = 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    w += glyphFor(font, text.charCodeAt(i)).width;
    n++;
  }
  return w + spacing * Math.max(0, n - 1);
}

export interface RenderOptions {
  /** Palette index for set pixels of mono fonts (default 1). Shaded fonts keep their own indices. */
  ink?: number;
  /** Palette index for background pixels (default 0). */
  background?: number;
  /** Extra pixels between glyphs (default 0). */
  spacing?: number;
}

/** Render `text` (lines split on '\n') to a paletted image. */
export function renderString(font: Font, text: string, opts: RenderOptions = {}): IndexedImage {
  const { ink = 1, background = 0, spacing = 0 } = opts;
  const lines = text.split('\n');
  const width = Math.max(1, ...lines.map((l) => measureString(font, l, spacing)));
  const height = Math.max(1, lines.length * font.height);
  const pixels = new Uint8Array(width * height).fill(background);
  lines.forEach((line, row) => {
    let x = 0;
    for (let i = 0; i < line.length; i++) {
      const g = glyphFor(font, line.charCodeAt(i));
      for (let gy = 0; gy < g.height; gy++) {
        for (let gx = 0; gx < g.width; gx++) {
          const p = g.pixels[gy * g.width + gx]!;
          if (p === 0) continue;
          pixels[(row * font.height + gy) * width + x + gx] = font.version === FNT_VERSION_MONO ? ink : p;
        }
      }
      x += g.width + spacing;
    }
  });
  return { width, height, pixels };
}
