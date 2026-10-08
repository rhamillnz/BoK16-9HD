import { Reader } from './reader';

export type TextAlignment = 'left' | 'right' | 'justify' | 'center';

/** Font style bits of a text segment (1 normal, 2 bold, 4 italic, 8 underlined, 16 ghosted). */
export const BookFontStyle = { Normal: 1, Bold: 2, Italic: 4, Underlined: 8, Ghosted: 16 } as const;

export interface BookTextSegment {
  font: number;
  yOffset: number;
  color: number;
  style: number;
  text: string;
}

export interface BookParagraph {
  x: number;
  y: number;
  width: number;
  lineSpacing: number;
  wordSpacing: number;
  startIndent: number;
  alignment: TextAlignment;
  segments: BookTextSegment[];
}

/** An illustration: `image` indexes BOOK.BMX; positions are in book units (twice scene pixels). */
export interface BookImage {
  x: number;
  y: number;
  image: number;
  /** 0 none, 1 horizontal, 2 vertical, 3 both. */
  mirroring: number;
}

export interface BookPage {
  x: number;
  y: number;
  width: number;
  height: number;
  displayNumber: number;
  pageNumber: number;
  previousPage: number;
  nextPage: number;
  showPageNumber: number;
  reservedAreas: { x: number; y: number; width: number; height: number }[];
  images: BookImage[];
  paragraphs: BookParagraph[];
}

export interface Book {
  pages: BookPage[];
}

const END_PAGE = 0xf0;
const START_PARAGRAPH = 0xf1;
const START_TEXT = 0xf4;
/** Text runs end at the first byte from here up; below it every byte is a printable character. */
const TEXT_LIMIT = 0xb1;
const ALIGNMENTS: TextAlignment[] = ['left', 'left', 'right', 'justify', 'center'];

function parsePage(r: Reader): BookPage {
  const x = r.i16();
  const y = r.i16();
  const width = r.i16();
  const height = r.i16();
  const displayNumber = r.u16();
  const pageNumber = r.u16();
  const previousPage = r.u16();
  const nextPage = r.u16();
  r.skip(4); // page pointer and a reserved word
  const imageCount = r.u16();
  const reservedCount = r.u16();
  const showPageNumber = r.u16();
  r.skip(30);
  const page: BookPage = {
    x,
    y,
    width,
    height,
    displayNumber,
    pageNumber,
    previousPage,
    nextPage,
    showPageNumber,
    reservedAreas: [],
    images: [],
    paragraphs: [],
  };
  for (let i = 0; i < reservedCount; i++)
    page.reservedAreas.push({ x: r.i16(), y: r.i16(), width: r.i16(), height: r.i16() });
  for (let i = 0; i < imageCount; i++) page.images.push({ x: r.i16(), y: r.i16(), image: r.u16(), mirroring: r.u16() });

  let paragraph: BookParagraph | undefined;
  while (!r.atEnd()) {
    const code = r.u8();
    if (code === END_PAGE) break;
    if (code === START_PARAGRAPH) {
      if (paragraph) page.paragraphs.push(paragraph);
      const px = r.i16();
      const width = r.i16();
      const lineSpacing = r.u16();
      const wordSpacing = r.u16();
      const startIndent = r.u16();
      r.skip(2);
      const py = r.i16();
      const alignment = ALIGNMENTS[r.u16()] ?? 'left';
      paragraph = { x: px, y: py, width, lineSpacing, wordSpacing, startIndent, alignment, segments: [] };
    } else if (code === START_TEXT && paragraph) {
      const font = r.u16();
      const yOffset = r.i16();
      const color = r.u16();
      r.skip(2);
      const style = r.u16();
      let text = '';
      while (!r.atEnd() && r.bytes[r.pos]! < TEXT_LIMIT) text += String.fromCharCode(r.u8());
      paragraph.segments.push({ font, yOffset, color, style, text });
    }
    // any other code is skipped
  }
  if (paragraph) page.paragraphs.push(paragraph);
  return page;
}

/**
 * Parse a `.BOK` book chapter: u32 size, u16 page count, u32 page offsets (from byte 4), then the pages.
 * A truncated file keeps the pages that decode. See docs/formats/books.md.
 */
export function parseBook(bytes: Uint8Array): Book {
  const r = new Reader(bytes);
  r.u32();
  const count = r.u16();
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(r.u32() + 4);
  const pages: BookPage[] = [];
  for (const offset of offsets) {
    if (offset >= bytes.length) break;
    try {
      pages.push(parsePage(new Reader(bytes, offset)));
    } catch {
      break;
    }
  }
  return { pages };
}

/** The reading text of a book: the paragraphs of the first page that has any, as the original player lays it out. */
export function bookText(book: Book): string {
  const page = book.pages.find((p) => p.paragraphs.length > 0);
  if (!page) return '';
  let out = '    ';
  for (const p of page.paragraphs) {
    out += '    ';
    for (const s of p.segments) out += (s.style & BookFontStyle.Italic ? '\xf3' : '') + s.text;
    out += '\n\xf8';
  }
  return out;
}
