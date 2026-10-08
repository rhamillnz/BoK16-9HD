/**
 * The three compression schemes used by BaK resources.
 * Method ids match the values stored in file headers.
 */
export const Compression = {
  LZW: 0,
  LZSS: 1,
  RLE: 2,
} as const;

/**
 * Growable output buffer. Decoders stop when either input is exhausted or the
 * expected output size is reached, mirroring the original engine.
 */
class Output {
  buf: Uint8Array;
  len = 0;
  constructor(private readonly limit: number) {
    this.buf = new Uint8Array(limit);
  }
  full(): boolean {
    return this.len >= this.limit;
  }
  put(b: number): void {
    if (this.len < this.limit) this.buf[this.len++] = b;
  }
  result(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

/** Byte-oriented RLE: high bit set = repeat next byte (n & 0x7f) times, else copy n literal bytes. */
export function decompressRLE(src: Uint8Array, outSize: number, start = 0): { data: Uint8Array; consumed: number } {
  const out = new Output(outSize);
  let p = start;
  while (p < src.length && !out.full()) {
    const control = src[p++]!;
    if (control & 0x80) {
      const value = src[p++] ?? 0;
      for (let i = 0; i < (control & 0x7f); i++) out.put(value);
    } else {
      for (let i = 0; i < control && p < src.length; i++) out.put(src[p++]!);
    }
  }
  return { data: out.result(), consumed: p - start };
}

/**
 * LZSS variant: a flag byte governs the next 8 items (LSB first).
 * Set bit = literal byte; clear bit = u16 absolute output offset + u8 length (+5).
 */
export function decompressLZSS(src: Uint8Array, outSize: number): Uint8Array {
  const out = new Output(outSize);
  let p = 0;
  let code = 0;
  let mask = 0;
  while (p < src.length && !out.full()) {
    if (mask === 0) {
      code = src[p++]!;
      mask = 0x01;
    }
    if (code & mask) {
      out.put(src[p++]!);
    } else {
      if (p + 3 > src.length) break;
      const off = src[p]! | (src[p + 1]! << 8);
      const len = src[p + 2]! + 5;
      p += 3;
      // Byte-by-byte so overlapping back-references replicate correctly.
      for (let i = 0; i < len; i++) out.put(out.buf[off + i] ?? 0);
    }
    mask = (mask << 1) & 0xff;
  }
  return out.result();
}

/**
 * LZW with LSB-first variable-width codes (9..12 bits).
 * Code 256 resets the dictionary; after a reset the stream is padded so the
 * next code starts on a boundary of the current code-group size, as in the
 * original Sierra/Dynamix encoder.
 */
export function decompressLZW(src: Uint8Array, outSize: number): Uint8Array {
  const out = new Output(outSize);
  const prefix = new Uint16Array(4096);
  const append = new Uint8Array(4096);
  const stack = new Uint8Array(4096);

  let bytePos = 0;
  let bitPos = 0;
  const totalBits = src.length * 8;
  const readBits = (n: number): number => {
    let x = 0;
    for (let i = 0; i < n; i++) {
      if (src[bytePos]! & (1 << bitPos)) x |= 1 << i;
      if (++bitPos > 7) {
        bytePos++;
        bitPos = 0;
      }
    }
    return x;
  };
  const canRead = (n: number) => bytePos * 8 + bitPos + n <= totalBits;

  let nBits = 9;
  let freeEntry = 257;
  if (!canRead(nBits)) return out.result();
  let oldCode = readBits(nBits);
  let lastByte = oldCode;
  out.put(oldCode);
  // Bits read since the last width change or reset; used to compute reset padding.
  let groupBits = 0;

  while (canRead(nBits) && !out.full()) {
    const newCode = readBits(nBits);
    groupBits += nBits;
    if (newCode === 256) {
      // Skip to the next byte, then to the end of the current nBits*8-bit group.
      if (bitPos) {
        bytePos++;
        bitPos = 0;
      }
      const group = nBits << 3;
      const padded = Math.ceil(groupBits / group) * group;
      const extraBytes = (padded - groupBits) >> 3;
      bytePos += extraBytes;
      nBits = 9;
      freeEntry = 256;
      groupBits = 0;
      continue;
    }

    let code = newCode;
    let sp = 0;
    if (code >= freeEntry) {
      stack[sp++] = lastByte;
      code = oldCode;
    }
    while (code >= 256) {
      if (sp >= 4095) throw new Error(`LZW: code chain cycle at input byte ${bytePos}`);
      stack[sp++] = append[code]!;
      code = prefix[code]!;
    }
    stack[sp++] = code;
    lastByte = code;
    while (sp > 0) out.put(stack[--sp]!);

    if (freeEntry < 4096) {
      prefix[freeEntry] = oldCode;
      append[freeEntry] = lastByte;
      freeEntry++;
      if (freeEntry >= 1 << nBits && nBits < 12) {
        nBits++;
        groupBits = 0;
      }
    }
    oldCode = newCode;
  }
  return out.result();
}

export function decompress(method: number, src: Uint8Array, outSize: number): Uint8Array {
  switch (method) {
    case Compression.LZW: {
      // LZW streams carry their own header: u8 0x02, u32 decompressed size.
      if (src.length < 5 || src[0] !== 0x02) throw new Error('LZW: missing 0x02 header');
      const size = (src[1]! | (src[2]! << 8) | (src[3]! << 16) | (src[4]! << 24)) >>> 0;
      return decompressLZW(src.subarray(5), Math.max(size, outSize));
    }
    case Compression.LZSS:
      return decompressLZSS(src, outSize);
    case Compression.RLE:
      return decompressRLE(src, outSize).data;
    default:
      throw new Error(`unknown compression method ${method}`);
  }
}
