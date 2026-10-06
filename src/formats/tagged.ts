/**
 * Many BaK resources are sequences of tagged chunks: a 4-char tag such as
 * "VGA:" followed by a u32 size. Container chunks set the high bit of the size.
 */
export function findTag(bytes: Uint8Array, tag: string): Uint8Array | undefined {
  if (tag.length !== 4) throw new Error(`tag must be 4 chars: ${tag}`);
  const t0 = tag.charCodeAt(0);
  const t1 = tag.charCodeAt(1);
  const t2 = tag.charCodeAt(2);
  const t3 = tag.charCodeAt(3);
  for (let i = 0; i + 8 <= bytes.length; i++) {
    if (bytes[i] === t0 && bytes[i + 1] === t1 && bytes[i + 2] === t2 && bytes[i + 3] === t3) {
      const size =
        (bytes[i + 4]! | (bytes[i + 5]! << 8) | (bytes[i + 6]! << 16) | (bytes[i + 7]! << 24)) & 0x7fffffff;
      const start = i + 8;
      return bytes.subarray(start, Math.min(start + size, bytes.length));
    }
  }
  return undefined;
}

export function requireTag(bytes: Uint8Array, tag: string): Uint8Array {
  const chunk = findTag(bytes, tag);
  if (!chunk) throw new Error(`tag not found: ${tag}`);
  return chunk;
}
