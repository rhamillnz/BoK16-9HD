import { describe, expect, it } from 'vitest';
import type { Book, BookPage } from '../formats/book';
import type { Font } from '../formats/fnt';
import { layoutBook } from './book';
import { BookScreen } from '../ui/bookScreen';
import type { HudHost } from '../ui/hudRegistry';

/** Every character 8 wide and 7 high (rows are 8 apart). */
const font: Font = {
  version: 0xff, maxWidth: 8, height: 7, baseline: 6, firstChar: 32,
  glyphs: Array.from({ length: 96 }, (_, i) => ({ code: 32 + i, width: 8, height: 7, pixels: new Uint8Array(56) })),
};

const mkPage = (o: Partial<BookPage> = {}): BookPage => ({
  x: 0, y: 0, width: 160, height: 32, displayNumber: 1, pageNumber: 1, previousPage: 0, nextPage: 0, showPageNumber: 0,
  reservedAreas: [], images: [], paragraphs: [], ...o,
});
const para = (text: string) => ({ x: 0, y: 0, width: 100, lineSpacing: 0, wordSpacing: 0, startIndent: 0, alignment: 'left' as const, segments: [{ font: 1, yOffset: 0, color: 0, style: 1, text }] });

/** A box of 80 x 16 scene pixels: 10 characters across, 2 rows. */
const book = (text: string, pages = 3): Book => ({
  pages: Array.from({ length: pages }, (_, i) => mkPage(i === 0 ? { paragraphs: [para(text)] } : {})),
});

describe('layoutBook', () => {
  it('pours the text into the pages in turn', () => {
    const spreads = layoutBook(book('aaaa bbbb cccc dddd eeee ffff gggg'), font);
    expect(spreads.length).toBeGreaterThan(1);
    expect(spreads.every((s) => s.lines.length > 0)).toBe(true);
    expect(spreads.every((s) => s.lines.length <= 2 + 1)).toBe(true);
    const words = spreads.flatMap((s) => s.lines.map((l) => l.text)).join(' ').split(/\s+/).filter(Boolean);
    expect(words).toEqual(['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee', 'ffff', 'gggg']);
  });

  it('wraps back to the first page when there are more spreads than pages', () => {
    const spreads = layoutBook(book('aaaa '.repeat(30), 2), font);
    expect(spreads.length).toBeGreaterThan(2);
    expect(spreads[2]!.page).toBe(spreads[0]!.page);
  });

  it('gives one spread per page when there is no text, and none for an empty book', () => {
    expect(layoutBook({ pages: [mkPage(), mkPage()] }, font)).toHaveLength(2);
    expect(layoutBook({ pages: [] }, font)).toEqual([]);
  });
});

describe('BookScreen', () => {
  const host = { width: 640, height: 400, font, invalidate: () => undefined } as unknown as HudHost;
  const open = (text: string) => {
    let done = 0;
    const screen = new BookScreen(host);
    const ok = screen.open({ book: book(text), images: [], done: () => done++ });
    return { screen, ok, done: () => done };
  };

  it('turns pages with click or keys and finishes after the last one', () => {
    const t = open('aaaa '.repeat(12));
    expect(t.ok).toBe(true);
    let turns = 0;
    while (t.done() === 0 && turns < 50) {
      t.screen.event(turns % 2 ? { type: 'click', x: 1, y: 1 } : { type: 'key', key: ' ' });
      turns++;
    }
    expect(t.done()).toBe(1);
    expect(turns).toBeGreaterThan(1);
    t.screen.event({ type: 'click', x: 1, y: 1 });
    expect(t.done()).toBe(1);
  });

  it('skips the whole book on Escape, once', () => {
    const t = open('aaaa '.repeat(12));
    t.screen.escape();
    t.screen.close();
    expect(t.done()).toBe(1);
  });

  it('refuses to open without a view', () => {
    expect(new BookScreen(host).open(undefined)).toBe(false);
  });
});

describe('layoutBook beside pictures', () => {
  const size = (i: number) => (i === 0 ? { width: 32, height: 32 } : undefined); // 16 x 16 scene pixels
  const withInitial = (): Book => ({
    pages: [mkPage({ width: 320, height: 160, images: [{ x: 0, y: 0, image: 0, mirroring: 0 }], paragraphs: [para('aaaa '.repeat(40))] })],
  });

  it('indents the rows beside a drop cap and leaves the rest alone', () => {
    const lines = layoutBook(withInitial(), font, size)[0]!.lines;
    // 16 px picture + 2 px gap spans rows 0 and 1 (rows are 8 apart, 7 high)
    expect(lines[0]!.indent).toBe(18);
    expect(lines[1]!.indent).toBe(18);
    expect(lines[2]!.indent).toBeUndefined();
  });

  it('keeps every indented line inside the box and the words in order', () => {
    const spreads = layoutBook(withInitial(), font, size);
    for (const l of spreads.flatMap((s) => s.lines)) expect(l.text.length * 8 + (l.indent ?? 0)).toBeLessThanOrEqual(160);
    expect(spreads.flatMap((s) => s.lines.map((l) => l.text)).join(' ').split(/\s+/).filter(Boolean)).toHaveLength(40);
  });

  it('lays out unchanged without picture sizes', () => {
    expect(layoutBook(withInitial(), font)[0]!.lines.every((l) => l.indent === undefined)).toBe(true);
  });
});
