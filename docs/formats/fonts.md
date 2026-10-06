# Fonts (`*.FNT`)

Format notes for the `.FNT` bitmap fonts. Derived from reading `bak/font.cpp` in [BaKGL](https://github.com/xavieran/BaKGL) to understand the layout; our implementation is `src/formats/fnt.ts` and is written independently. All values are little-endian.

## Container

A `.FNT` file is located by the 4-char tag `"FNT:"` (`0x3a544e46`) followed by a `u32` size, like other tagged resources (see `src/formats/tagged.ts`). Everything below is inside that chunk.

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0 | u8 | `version` | `0xff` = 1bpp monochrome; `0xfd` = 8bpp shaded (`SPELL.FNT`). Anything else is rejected. |
| 1 | u8 | `maxWidth` | Widest glyph. Not used by the loader. |
| 2 | u8 | `height` | Glyph height in pixels, shared by all glyphs. Mono fonts are limited to 16. |
| 3 | u8 | `baseline` | Row of the text baseline. Not used by the loader. |
| 4 | u8 | `firstChar` | Character code of glyph 0. |
| 5 | u8 | `numChars` | Number of glyphs. |
| 6 | u16 | `dataLength` | Compressed payload length. Not needed to decode. |
| 8 | u8 | compression | Must be `0x01`, meaning RLE. |
| 9 | u32 | decompressed size | Size of the RLE output. |
| 13 | bytes | payload | RLE stream (same scheme as `decompressRLE`: high bit set = repeat next byte `n & 0x7f` times, else copy `n` literals). |

## Decompressed payload

```
u16  offsets[numChars]      glyph bitmap offsets
u8   widths[numChars]       glyph widths in pixels
...  glyph bitmaps
```

Glyph `i` has width `widths[i]` and its bitmap starts at `widthsStart + numChars + offsets[i]`, where `widthsStart` is the position right after the offset table (`2 * numChars`). Offsets are therefore relative to the end of the width table, not the start of the payload.

### Mono glyphs (`0xff`)

One row per scanline, top row first, `height` rows. Each row is 1 byte if `width <= 8`, otherwise 2 bytes (high byte first, so the row is a big-endian 16-bit value). Pixel `x` is set when `row & (0x8000 >> x)`; bits are left aligned, so a row of width 3 uses only the top 3 bits of the first byte. Set pixels are drawn in the text colour, unset ones are transparent. Widths above 16 cannot be represented.

### Shaded glyphs (`0xfd`)

`width * height` bytes, row-major, top row first. Each byte is a shade/palette index; `0` is transparent. BaKGL divides the index by 128 to produce a red intensity (an engine-side choice, not part of the file format).

## Text layout notes

- Glyph for character `c` is `glyphs[c - firstChar]`. BaKGL falls back to glyph 0 (with an error log) for codes below `firstChar`; we also use glyph 0 for codes past the last glyph.
- Advance is the glyph width; there is no kerning table. BaKGL uses the width of glyph 0 as the word-space width (its comment says "the width of 'a'", which is unverified; glyph 0 is the lowest character code and is usually the space).
- Text rows are `height` pixels apart.

## Our API (`src/formats/fnt.ts`)

- `parseFNT(bytes): Font` with `glyphs[]` of `{ code, width, height, pixels }` (pixels are 0/1 for mono, raw indices for shaded).
- `measureString(font, text, spacing?)` and `renderString(font, text, { ink, background, spacing })` returning an `IndexedImage` (lines split on `\n`).

## Unverified

No original font files are available in the cloud, so this has only been tested against synthetic fixtures built from the layout above (`tests/fnt.test.ts`). Points worth checking against a real `.FNT`: `dataLength` semantics, whether `maxWidth`/`baseline` match the glyph data, and the word-space width.
