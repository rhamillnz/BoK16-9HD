import { describe, expect, it } from 'vitest';
import { parseCredits } from '../src/formats/credits';
import { CREDITS_AREA, PRINTED_LINES, creditPages } from '../src/game/creditPages';

/** A CRED.DAT: words (string indexes into `strings`, or 0 for a line end), then the strings. */
function credBytes(words: (string | 0)[]): Uint8Array {
  const strings = [''];
  const offsets = new Map<string, number>([['', 0]]);
  let size = 1;
  for (const w of words) {
    if (w === 0 || offsets.has(w)) continue;
    offsets.set(w, size);
    strings.push(w);
    size += w.length + 1;
  }
  const out = new Uint8Array(4 + words.length * 2 + size);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, words.length, true);
  words.forEach((w, i) => dv.setUint16(4 + i * 2, w === 0 ? 0 : offsets.get(w)!, true));
  let o = 4 + words.length * 2;
  for (const s of strings) {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
    o += s.length + 1;
  }
  return out;
}

describe('parseCredits', () => {
  it('reads lines of strings ended by 0 words', () => {
    const lines = parseCredits(credBytes(['ART:', 'Mike', 0, 'Sean', 0, 0, 'The end', 0]));
    expect(lines).toEqual([['ART:', 'Mike'], ['Sean'], [], ['The end']]);
  });
});

describe('creditPages', () => {
  const printed = Array.from({ length: PRINTED_LINES }, () => ['PRINTED:', 'x']);

  it('skips the printed page, keeps names on the right and centres closing sentences', () => {
    const pages = creditPages([
      ...printed,
      ['ARTISTS:', 'Robert Kraft'],
      ['Sean Murphy'],
      [],
      [],
      ['Based on the universe'],
      ['by Midkemia Press'],
    ]);
    expect(pages).toHaveLength(1);
    const [a, b, c, d] = pages[0]!;
    expect(a).toEqual({ y: CREDITS_AREA.top, left: 'ARTISTS:', right: 'Robert Kraft' });
    expect(b).toMatchObject({ right: 'Sean Murphy' });
    expect(c).toMatchObject({ centre: 'Based on the universe' });
    expect(d).toMatchObject({ centre: 'by Midkemia Press' });
    expect(c!.y).toBeGreaterThan(b!.y + 10); // the gap shows
  });

  it('breaks pages inside the text area and fits the page count, tightening the spacing if needed', () => {
    const names = Array.from({ length: 180 }, (_, i) => (i % 6 === 0 ? [] : [`Name ${i}`]));
    const pages = creditPages([...printed, ['TESTERS:', 'First'], ...names], 20);
    expect(pages.length).toBeLessThanOrEqual(20);
    for (const page of pages) {
      expect(page[0]!.y).toBe(CREDITS_AREA.top);
      for (const r of page) expect(r.y + 9).toBeLessThanOrEqual(CREDITS_AREA.bottom);
    }
    expect(pages.flat().filter((r) => (r.right ?? r.centre)?.startsWith('Name'))).toHaveLength(150);
  });
});
