/**
 * CRED.DAT: the intro's credits. A u16 count of words, a u16 we do not use, then that many u16 words, then
 * zero-terminated strings. Each word is an offset into the strings (0 is the empty string at their start) and
 * a 0 word ends a line, so a line is a heading with its first name ("ART DIRECTOR:", "Mike McHugh"), a further
 * name, a sentence, or nothing (a gap).
 */
export function parseCredits(bytes: Uint8Array): string[][] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint16(0, true);
  const base = 4 + count * 2;
  if (base > bytes.length) throw new Error('CRED.DAT: word table runs past the end');
  const text = (offset: number): string => {
    let end = base + offset;
    while (end < bytes.length && bytes[end] !== 0) end++;
    return String.fromCharCode(...bytes.subarray(base + offset, end));
  };
  const lines: string[][] = [];
  let line: string[] = [];
  for (let i = 0; i < count; i++) {
    const w = dv.getUint16(4 + i * 2, true);
    if (w === 0) {
      lines.push(line);
      line = [];
    } else {
      const t = text(w);
      if (t) line.push(t);
    }
  }
  if (line.length) lines.push(line);
  return lines;
}
