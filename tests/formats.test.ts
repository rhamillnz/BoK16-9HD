import { describe, expect, it } from 'vitest';
import { Reader } from '../src/formats/reader';
import { Compression, decompress, decompressLZSS, decompressLZW, decompressRLE } from '../src/formats/compression';
import { findTag, requireTag } from '../src/formats/tagged';
import { greyscalePalette, parsePalette } from '../src/formats/palette';

/**
 * LSB-first bit writer for the test LZW encoder.
 */
class BitWriter {
  readonly bytes: number[] = [];
  private currentByte = 0;
  private bitPos = 0;

  writeBits(value: number, n: number): void {
    for (let i = 0; i < n; i++) {
      if (value & (1 << i)) {
        this.currentByte |= 1 << this.bitPos;
      }
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bytes.push(this.currentByte);
        this.currentByte = 0;
        this.bitPos = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.bitPos > 0) {
      this.bytes.push(this.currentByte);
      this.currentByte = 0;
      this.bitPos = 0;
    }
    return new Uint8Array(this.bytes);
  }
}

/**
 * Small LZW encoder matching the BaK decompression scheme:
 * - LSB-first variable-width codes starting at 9 bits up to 12 bits.
 * - Literals 0-255.
 * - First free entry is 257 (code 256 is reserved / unused).
 * - Code width increases when nextCode reaches 1 << width.
 */
function encodeLZW(src: Uint8Array): { encoded: Uint8Array; maxCode: number; maxBits: number } {
  if (src.length === 0) {
    return { encoded: new Uint8Array(0), maxCode: 255, maxBits: 9 };
  }

  const writer = new BitWriter();
  let nBits = 9;
  let nextCode = 257;
  let maxCode = 0;
  let maxBits = 9;

  // Key is (curCode << 8) | nextByte -> assigned code
  const dict = new Map<number, number>();

  let curCode = src[0]!;
  if (curCode > maxCode) maxCode = curCode;

  for (let i = 1; i < src.length; i++) {
    const b = src[i]!;
    const key = (curCode << 8) | b;
    const existing = dict.get(key);
    if (existing !== undefined) {
      curCode = existing;
    } else {
      writer.writeBits(curCode, nBits);
      if (curCode > maxCode) maxCode = curCode;
      if (nBits > maxBits) maxBits = nBits;

      if (nextCode < 4096) {
        dict.set(key, nextCode);
        nextCode++;
        if (nextCode > 1 << nBits && nBits < 12) {
          nBits++;
        }
      }
      curCode = b;
    }
  }

  writer.writeBits(curCode, nBits);
  if (curCode > maxCode) maxCode = curCode;
  if (nBits > maxBits) maxBits = nBits;

  return { encoded: writer.finish(), maxCode, maxBits };
}

describe('Reader (src/formats/reader.ts)', () => {
  it('reads unsigned integers in little-endian format', () => {
    // u8: 0, 127, 128, 255
    const rU8 = new Reader(new Uint8Array([0x00, 0x7f, 0x80, 0xff]));
    expect(rU8.u8()).toBe(0);
    expect(rU8.u8()).toBe(127);
    expect(rU8.u8()).toBe(128);
    expect(rU8.u8()).toBe(255);
    expect(rU8.atEnd()).toBe(true);

    // u16 LE: 0x1234 (4660), 0xfffe (65534)
    const rU16 = new Reader(new Uint8Array([0x34, 0x12, 0xfe, 0xff]));
    expect(rU16.u16()).toBe(0x1234);
    expect(rU16.u16()).toBe(0xfffe);
    expect(rU16.atEnd()).toBe(true);

    // u32 LE: 0x12345678 (305419896), 0xffffffff (4294967295)
    const rU32 = new Reader(new Uint8Array([0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff]));
    expect(rU32.u32()).toBe(0x12345678);
    expect(rU32.u32()).toBe(0xffffffff);
    expect(rU32.atEnd()).toBe(true);
  });

  it('reads signed integers in little-endian format', () => {
    // i16 LE: -2 (0xfffe), -32768 (0x8000), 1 (0x0001)
    const rI16 = new Reader(new Uint8Array([0xfe, 0xff, 0x00, 0x80, 0x01, 0x00]));
    expect(rI16.i16()).toBe(-2);
    expect(rI16.i16()).toBe(-32768);
    expect(rI16.i16()).toBe(1);
    expect(rI16.atEnd()).toBe(true);

    // i32 LE: -1 (0xffffffff), -2147483648 (0x80000000), 42 (0x0000002a)
    const rI32 = new Reader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x80, 0x2a, 0x00, 0x00, 0x00]));
    expect(rI32.i32()).toBe(-1);
    expect(rI32.i32()).toBe(-2147483648);
    expect(rI32.i32()).toBe(42);
    expect(rI32.atEnd()).toBe(true);
  });

  it('reads NUL-padded ASCII strings via fixedString', () => {
    // NUL-padded string
    const r1 = new Reader(new Uint8Array([0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x00, 0x00, 0x00])); // "HELLO\0\0\0"
    expect(r1.fixedString(8)).toBe('HELLO');
    expect(r1.atEnd()).toBe(true);

    // Exact length string without NUL terminator
    const r2 = new Reader(new Uint8Array([0x54, 0x45, 0x53, 0x54])); // "TEST"
    expect(r2.fixedString(4)).toBe('TEST');
    expect(r2.atEnd()).toBe(true);

    // String starting with NUL terminator returns empty string
    const r3 = new Reader(new Uint8Array([0x00, 0x41, 0x42, 0x43])); // "\0ABC"
    expect(r3.fixedString(4)).toBe('');
    expect(r3.atEnd()).toBe(true);

    // String with embedded NUL stops at first NUL
    const r4 = new Reader(new Uint8Array([0x46, 0x4f, 0x4f, 0x00, 0x42, 0x41, 0x52])); // "FOO\0BAR"
    expect(r4.fixedString(7)).toBe('FOO');
    expect(r4.atEnd()).toBe(true);
  });

  it('handles skip, bytesView, pos, remaining, and atEnd correctly', () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const reader = new Reader(bytes);

    expect(reader.length).toBe(8);
    expect(reader.pos).toBe(0);
    expect(reader.remaining).toBe(8);
    expect(reader.atEnd()).toBe(false);

    reader.skip(2);
    expect(reader.pos).toBe(2);
    expect(reader.remaining).toBe(6);
    expect(reader.atEnd()).toBe(false);

    const view = reader.bytesView(3);
    expect(Array.from(view)).toEqual([30, 40, 50]);
    expect(reader.pos).toBe(5);
    expect(reader.remaining).toBe(3);

    reader.skip(3);
    expect(reader.pos).toBe(8);
    expect(reader.remaining).toBe(0);
    expect(reader.atEnd()).toBe(true);

    // Empty reader
    const emptyReader = new Reader(new Uint8Array(0));
    expect(emptyReader.length).toBe(0);
    expect(emptyReader.remaining).toBe(0);
    expect(emptyReader.atEnd()).toBe(true);
  });

  it('throws RangeError when reading past the end of the buffer', () => {
    const empty = new Reader(new Uint8Array(0));
    expect(() => empty.u8()).toThrow(RangeError);
    expect(() => empty.u16()).toThrow(RangeError);
    expect(() => empty.i16()).toThrow(RangeError);
    expect(() => empty.u32()).toThrow(RangeError);
    expect(() => empty.i32()).toThrow(RangeError);
    expect(() => empty.fixedString(1)).toThrow(RangeError);
    expect(() => empty.bytesView(1)).toThrow(RangeError);
    expect(() => empty.skip(1)).toThrow(RangeError);

    // Insufficient remaining bytes for multi-byte reads
    const oneByte = new Reader(new Uint8Array([0x42]));
    expect(() => oneByte.u16()).toThrow(RangeError);
    expect(() => oneByte.i16()).toThrow(RangeError);

    const threeBytes = new Reader(new Uint8Array([1, 2, 3]));
    expect(() => threeBytes.u32()).toThrow(RangeError);
    expect(() => threeBytes.i32()).toThrow(RangeError);
    expect(() => threeBytes.fixedString(4)).toThrow(RangeError);
    expect(() => threeBytes.bytesView(4)).toThrow(RangeError);
    expect(() => threeBytes.skip(4)).toThrow(RangeError);
  });
});

describe('Compression (src/formats/compression.ts)', () => {
  describe('decompressRLE', () => {
    it('decompresses literal runs (control < 0x80)', () => {
      // Control byte 3: copy 3 literal bytes [10, 20, 30]
      const src = new Uint8Array([3, 10, 20, 30]);
      const res = decompressRLE(src, 3);
      expect(Array.from(res.data)).toEqual([10, 20, 30]);
      expect(res.consumed).toBe(4);
    });

    it('decompresses repeat runs (control & 0x80 set)', () => {
      // Control byte 0x85 (0x80 | 5): repeat next byte (99) 5 times
      const src = new Uint8Array([0x85, 99]);
      const res = decompressRLE(src, 5);
      expect(Array.from(res.data)).toEqual([99, 99, 99, 99, 99]);
      expect(res.consumed).toBe(2);
    });

    it('decompresses mixed literal and repeat runs', () => {
      // 2 literals [1, 2], repeat 99 3 times (0x83), 1 literal [7]
      const src = new Uint8Array([2, 1, 2, 0x83, 99, 1, 7]);
      const res = decompressRLE(src, 6);
      expect(Array.from(res.data)).toEqual([1, 2, 99, 99, 99, 7]);
      expect(res.consumed).toBe(7);
    });

    it('stops output when outSize is reached and tracks consumed count', () => {
      // Literal run exceeding outSize:
      // Control byte 5, but outSize is 3
      const src1 = new Uint8Array([5, 10, 20, 30, 40, 50]);
      const res1 = decompressRLE(src1, 3);
      expect(Array.from(res1.data)).toEqual([10, 20, 30]);
      expect(res1.consumed).toBe(6);

      // Repeat run exceeding outSize:
      // Control byte 0x80 | 8, value 7, outSize 3
      const src2 = new Uint8Array([0x88, 7]);
      const res2 = decompressRLE(src2, 3);
      expect(Array.from(res2.data)).toEqual([7, 7, 7]);
      expect(res2.consumed).toBe(2);

      // Subsequent chunks are not read once output buffer is full:
      // Chunk 1 has 2 literals [10, 20]; Chunk 2 has 2 literals [30, 40].
      // outSize is 2, so chunk 2 should never be consumed.
      const src3 = new Uint8Array([2, 10, 20, 2, 30, 40]);
      const res3 = decompressRLE(src3, 2);
      expect(Array.from(res3.data)).toEqual([10, 20]);
      expect(res3.consumed).toBe(3);
    });

    it('respects optional start offset parameter', () => {
      const src = new Uint8Array([0xff, 0xff, 2, 11, 22]);
      const res = decompressRLE(src, 2, 2);
      expect(Array.from(res.data)).toEqual([11, 22]);
      expect(res.consumed).toBe(3);
    });
  });

  describe('decompressLZSS', () => {
    it('decompresses 8 literal bytes governed by flag byte 0xFF', () => {
      // Flag 0xFF: all 8 items are literals
      const src = new Uint8Array([0xff, 1, 2, 3, 4, 5, 6, 7, 8]);
      const res = decompressLZSS(src, 8);
      expect(Array.from(res)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('decompresses literals followed by a non-overlapping back-reference', () => {
      // 5 literals: [10, 20, 30, 40, 50]
      // Then clear bit (0) -> back-reference:
      // offset = 0 (LE: 0x00, 0x00), length byte = 0 (copies 0 + 5 = 5 bytes)
      // Flag byte: bits 0..4 set (1), bit 5 clear (0) -> 0b00011111 = 0x1f
      const src = new Uint8Array([0x1f, 10, 20, 30, 40, 50, 0x00, 0x00, 0x00]);
      const res = decompressLZSS(src, 10);
      expect(Array.from(res)).toEqual([10, 20, 30, 40, 50, 10, 20, 30, 40, 50]);
    });

    it('decompresses overlapping back-references (single byte replication)', () => {
      // 1 literal [0xAA] (bit 0 = 1)
      // Followed by back-reference from offset 0, length byte = 2 (copies 2 + 5 = 7 bytes) (bit 1 = 0)
      // Flag byte: 0b00000001 = 0x01
      const src = new Uint8Array([0x01, 0xaa, 0x00, 0x00, 0x02]);
      const res = decompressLZSS(src, 8);
      expect(Array.from(res)).toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa]);
    });

    it('decompresses overlapping back-references (multi-byte pattern replication)', () => {
      // 3 literals: [1, 2, 3] (bits 0, 1, 2 = 1)
      // Followed by back-reference from offset 0, length byte = 4 (copies 4 + 5 = 9 bytes) (bit 3 = 0)
      // Replicates [1, 2, 3] 3 times -> 12 bytes total
      // Flag byte: 0b00000111 = 0x07
      const src = new Uint8Array([0x07, 1, 2, 3, 0x00, 0x00, 0x04]);
      const res = decompressLZSS(src, 12);
      expect(Array.from(res)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
    });

    it('decompresses across multiple flag bytes (> 8 items)', () => {
      // Flag 1: 0xFF (8 literals [1..8])
      // Flag 2: 0x01 (1 literal [9])
      const src = new Uint8Array([0xff, 1, 2, 3, 4, 5, 6, 7, 8, 0x01, 9]);
      const res = decompressLZSS(src, 9);
      expect(Array.from(res)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('stops output when outSize is reached', () => {
      const src = new Uint8Array([0xff, 1, 2, 3, 4, 5, 6, 7, 8]);
      const res = decompressLZSS(src, 4);
      expect(Array.from(res)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('decompressLZW', () => {
    it('round-trips short ASCII strings', () => {
      const text = 'Hello, Betrayal at Krondor!';
      const input = new TextEncoder().encode(text);
      const { encoded } = encodeLZW(input);

      const decoded = decompressLZW(encoded, input.length);
      expect(new TextDecoder().decode(decoded)).toBe(text);
    });

    it('round-trips repeating pattern and handles empty input', () => {
      const empty = new Uint8Array(0);
      expect(decompressLZW(encodeLZW(empty).encoded, 0)).toEqual(new Uint8Array(0));

      const single = new Uint8Array([42]);
      expect(decompressLZW(encodeLZW(single).encoded, 1)).toEqual(single);

      // Repetitive pattern
      const pattern = new Uint8Array(120);
      for (let i = 0; i < pattern.length; i++) {
        pattern[i] = i % 3 === 0 ? 65 : i % 3 === 1 ? 66 : 67; // "ABCABC..."
      }
      const { encoded } = encodeLZW(pattern);
      const decoded = decompressLZW(encoded, pattern.length);
      expect(decoded).toEqual(pattern);
    });

    it('round-trips repetitive data long enough to push code width to 10+ bits', () => {
      // To push dictionary beyond 512 entries, we create a structured dataset with
      // many distinct sequences so that nextCode exceeds 512.
      const size = 2500;
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        // Pseudo-random repetitive pattern with broad alphabet
        data[i] = ((i * 17 + (i >> 3) * 31) & 0x7f) + 32;
      }

      const { encoded, maxCode, maxBits } = encodeLZW(data);

      // Verify that code width actually exceeded 9 bits (10+ bits)
      expect(maxBits).toBeGreaterThanOrEqual(10);
      expect(maxCode).toBeGreaterThanOrEqual(512);

      const decoded = decompressLZW(encoded, data.length);
      expect(decoded.length).toBe(data.length);
      expect(decoded).toEqual(data);
    });
  });

  describe('decompress dispatcher', () => {
    it('dispatches method 0 (LZW) requiring 5-byte header (0x02 + u32 LE size)', () => {
      const payload = new TextEncoder().encode('Testing LZW Header Dispatch');
      const { encoded } = encodeLZW(payload);

      // Construct stream with 5-byte header: 0x02, followed by u32 LE size
      const header = new Uint8Array(5);
      header[0] = 0x02;
      new DataView(header.buffer).setUint32(1, payload.length, true);

      const stream = new Uint8Array(header.length + encoded.length);
      stream.set(header, 0);
      stream.set(encoded, 5);

      const res = decompress(Compression.LZW, stream, payload.length);
      expect(new TextDecoder().decode(res)).toBe('Testing LZW Header Dispatch');
    });

    it('method 0 (LZW) throws without valid 0x02 header or when length < 5', () => {
      // Short stream (< 5 bytes)
      const shortStream = new Uint8Array([0x02, 0x01, 0x00, 0x00]);
      expect(() => decompress(Compression.LZW, shortStream, 10)).toThrow('LZW: missing 0x02 header');

      // First byte is not 0x02
      const badHeader = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x55]);
      expect(() => decompress(Compression.LZW, badHeader, 10)).toThrow('LZW: missing 0x02 header');
    });

    it('dispatches method 1 to LZSS and method 2 to RLE', () => {
      // Method 1 (LZSS): 4 literals
      const lzssSrc = new Uint8Array([0xff, 11, 22, 33, 44]);
      const lzssRes = decompress(Compression.LZSS, lzssSrc, 4);
      expect(Array.from(lzssRes)).toEqual([11, 22, 33, 44]);

      // Method 2 (RLE): repeat byte 77 4 times
      const rleSrc = new Uint8Array([0x84, 77]);
      const rleRes = decompress(Compression.RLE, rleSrc, 4);
      expect(Array.from(rleRes)).toEqual([77, 77, 77, 77]);
    });

    it('throws on unknown compression method', () => {
      const src = new Uint8Array([0, 1, 2]);
      expect(() => decompress(3, src, 10)).toThrow('unknown compression method 3');
      expect(() => decompress(99, src, 10)).toThrow('unknown compression method 99');
    });
  });
});

describe('Tagged chunks (src/formats/tagged.ts)', () => {
  it('findTag finds a 4-char tag anywhere and masks off high bit 0x80000000', () => {
    // Build a buffer with padding + chunk:
    // Tag: "TEST"
    // Size: 4 with container high bit set (0x80000004)
    // Payload: [0xaa, 0xbb, 0xcc, 0xdd]
    const prefix = new Uint8Array([0x00, 0x11, 0x22]); // 3 bytes of garbage
    const tag = new TextEncoder().encode('TEST');
    const sizeBytes = new Uint8Array([0x04, 0x00, 0x00, 0x80]); // 4 | 0x80000000 LE
    const payload = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const suffix = new Uint8Array([0x99, 0x88]);

    const buffer = new Uint8Array(prefix.length + tag.length + sizeBytes.length + payload.length + suffix.length);
    let offset = 0;
    buffer.set(prefix, offset);
    offset += prefix.length;
    buffer.set(tag, offset);
    offset += tag.length;
    buffer.set(sizeBytes, offset);
    offset += sizeBytes.length;
    buffer.set(payload, offset);
    offset += payload.length;
    buffer.set(suffix, offset);

    const found = findTag(buffer, 'TEST');
    expect(found).toBeDefined();
    expect(Array.from(found!)).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  it('findTag returns undefined when tag is missing', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(findTag(buffer, 'MISS')).toBeUndefined();
  });

  it('findTag throws when tag is not exactly 4 characters', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => findTag(buffer, 'TAG')).toThrow('tag must be 4 chars: TAG');
    expect(() => findTag(buffer, 'TOOLONG')).toThrow('tag must be 4 chars: TOOLONG');
  });

  it('requireTag returns payload when tag exists and throws when missing', () => {
    // Valid tagged chunk: "DATA" with size 2, payload [7, 8]
    const valid = new Uint8Array([
      0x44,
      0x41,
      0x54,
      0x41, // "DATA"
      0x02,
      0x00,
      0x00,
      0x00, // size 2
      0x07,
      0x08, // payload
    ]);
    const payload = requireTag(valid, 'DATA');
    expect(Array.from(payload)).toEqual([0x07, 0x08]);

    // Missing tag throws
    expect(() => requireTag(valid, 'NONE')).toThrow('tag not found: NONE');
  });
});

describe('Palette (src/formats/palette.ts)', () => {
  it('parsePalette scales 6-bit RGB values and sets index 0 alpha to 0, others to 255', () => {
    // Build a "VGA:" chunk with triples testing:
    // 63 -> 255
    // 0  -> 0
    // 32 -> 130  (formula (v << 2) | (v >> 4))
    //
    // Triple 0 (index 0): R=63, G=0, B=32
    // Expected RGBA: [255, 0, 130, 0] (alpha 0 for index 0)
    //
    // Triple 1 (index 1): R=32, G=63, B=0
    // Expected RGBA: [130, 255, 0, 255] (alpha 255 for index 1)
    //
    // Triple 2 (index 2): R=0, G=32, B=63
    // Expected RGBA: [0, 130, 255, 255] (alpha 255 for index 2)
    const triples = [
      63,
      0,
      32, // index 0
      32,
      63,
      0, // index 1
      0,
      32,
      63, // index 2
    ];

    const vgaPayload = new Uint8Array(triples);
    const chunk = new Uint8Array(8 + vgaPayload.length);
    // "VGA:" tag
    chunk.set([0x56, 0x47, 0x41, 0x3a], 0);
    // Size = 9 (u32 LE)
    new DataView(chunk.buffer).setUint32(4, vgaPayload.length, true);
    // Payload
    chunk.set(vgaPayload, 8);

    const pal = parsePalette(chunk);

    // Total palette length must be 256 * 4 = 1024
    expect(pal.length).toBe(1024);

    // Index 0: 63 -> 255, 0 -> 0, 32 -> 130, alpha = 0
    expect(pal[0]).toBe(255); // R
    expect(pal[1]).toBe(0); // G
    expect(pal[2]).toBe(130); // B
    expect(pal[3]).toBe(0); // Alpha 0 for index 0

    // Index 1: 32 -> 130, 63 -> 255, 0 -> 0, alpha = 255
    expect(pal[4]).toBe(130); // R
    expect(pal[5]).toBe(255); // G
    expect(pal[6]).toBe(0); // B
    expect(pal[7]).toBe(255); // Alpha 255 for non-zero index

    // Index 2: 0 -> 0, 32 -> 130, 63 -> 255, alpha = 255
    expect(pal[8]).toBe(0); // R
    expect(pal[9]).toBe(130); // G
    expect(pal[10]).toBe(255); // B
    expect(pal[11]).toBe(255); // Alpha 255 for non-zero index
  });

  it('parsePalette masks 6-bit values (& 0x3f) and sets alpha 255 for all non-zero entries in a 256-color palette', () => {
    // 256 RGB triples (768 bytes)
    const triples = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      // Set high bits (e.g. 0x80 | 32 = 160) to test that & 0x3f masks to 32 -> 130
      triples[i * 3 + 0] = 0x80 | 32;
      triples[i * 3 + 1] = 0x40 | 0;
      triples[i * 3 + 2] = 0xc0 | 63;
    }

    const chunk = new Uint8Array(8 + triples.length);
    chunk.set([0x56, 0x47, 0x41, 0x3a], 0); // "VGA:"
    new DataView(chunk.buffer).setUint32(4, triples.length, true);
    chunk.set(triples, 8);

    const pal = parsePalette(chunk);
    expect(pal.length).toBe(1024);

    // Index 0: alpha must be 0
    expect(pal[0]).toBe(130);
    expect(pal[1]).toBe(0);
    expect(pal[2]).toBe(255);
    expect(pal[3]).toBe(0);

    // All indices 1..255 must have alpha 255 and scaled RGB values
    for (let i = 1; i < 256; i++) {
      expect(pal[i * 4 + 0]).toBe(130);
      expect(pal[i * 4 + 1]).toBe(0);
      expect(pal[i * 4 + 2]).toBe(255);
      expect(pal[i * 4 + 3]).toBe(255);
    }
  });

  it('greyscalePalette creates a 256-color palette with transparent index 0', () => {
    const grey = greyscalePalette();
    expect(grey.length).toBe(1024);

    // Index 0
    expect(grey[0]).toBe(0);
    expect(grey[1]).toBe(0);
    expect(grey[2]).toBe(0);
    expect(grey[3]).toBe(0);

    // Index 128
    expect(grey[128 * 4 + 0]).toBe(128);
    expect(grey[128 * 4 + 1]).toBe(128);
    expect(grey[128 * 4 + 2]).toBe(128);
    expect(grey[128 * 4 + 3]).toBe(255);
  });
});
