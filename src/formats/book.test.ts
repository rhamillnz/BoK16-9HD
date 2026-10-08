import { describe, expect, it } from 'vitest';
import { bookText, parseBook } from './book';

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

interface Seg {
  text: string;
  style?: number;
}
/** A page: box, images, then one paragraph with the segments. */
function page(opts: { box?: number[]; images?: number[][]; segs?: Seg[] }): number[] {
  const [x = 0, y = 0, w = 0, h = 0] = opts.box ?? [20, 30, 300, 200];
  const images = opts.images ?? [];
  const out = [
    ...u16(x),
    ...u16(y),
    ...u16(w),
    ...u16(h),
    ...u16(1),
    ...u16(2),
    ...u16(0),
    ...u16(3),
    ...u16(0),
    0,
    0,
    ...u16(images.length),
    ...u16(0),
    ...u16(1),
    ...new Array(30).fill(0),
  ];
  for (const im of images) out.push(...im.flatMap(u16));
  if (opts.segs) {
    out.push(0xf1, ...u16(0), ...u16(280), ...u16(10), ...u16(4), ...u16(8), 0, 0, ...u16(0), ...u16(3));
    for (const s of opts.segs)
      out.push(0xf4, ...u16(1), ...u16(0), ...u16(5), 0, 0, ...u16(s.style ?? 1), ...ascii(s.text));
  }
  out.push(0xf0);
  return out;
}

function book(pages: number[][]): Uint8Array {
  const headerLen = 4 + 2 + pages.length * 4;
  const offsets: number[] = [];
  let at = headerLen - 4;
  for (const p of pages) {
    offsets.push(at);
    at += p.length;
  }
  return Uint8Array.from([...u32(at), ...u16(pages.length), ...offsets.flatMap(u32), ...pages.flat()]);
}

describe('parseBook', () => {
  it('reads pages, images and styled segments', () => {
    const b = parseBook(
      book([
        page({ images: [[10, 20, 3, 3]], segs: [{ text: 'Once upon ' }, { text: 'a time', style: 4 }] }),
        page({ box: [0, 0, 100, 80] }),
      ]),
    );
    expect(b.pages).toHaveLength(2);
    const p = b.pages[0]!;
    expect([p.x, p.y, p.width, p.height]).toEqual([20, 30, 300, 200]);
    expect(p.nextPage).toBe(3);
    expect(p.images).toEqual([{ x: 10, y: 20, image: 3, mirroring: 3 }]);
    expect(p.paragraphs[0]!.alignment).toBe('justify');
    expect(p.paragraphs[0]!.segments.map((s) => s.text)).toEqual(['Once upon ', 'a time']);
    expect(b.pages[1]!.paragraphs).toEqual([]);
  });

  it('keeps the pages that decode when the file is cut short', () => {
    const bytes = book([page({ segs: [{ text: 'Hi' }] }), page({})]);
    expect(parseBook(bytes.subarray(0, bytes.length - 40)).pages.length).toBeGreaterThanOrEqual(1);
    expect(parseBook(new Uint8Array([0, 0, 0, 0, 0, 0])).pages).toEqual([]);
  });

  it('builds the reading text with italic marks and paragraph ends', () => {
    const b = parseBook(book([page({ segs: [{ text: 'a ' }, { text: 'b', style: 4 }] })]));
    expect(bookText(b)).toBe('        a \xf3b\n\xf8');
  });
});
