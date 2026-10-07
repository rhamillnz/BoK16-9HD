import { bookText, type Book, type BookPage } from '../formats/book';
import type { Font } from '../formats/fnt';
import { wrapText, type TextLine } from '../ui/dialogBox';

/** Book coordinates are twice scene pixels. */
export const BOOK_UNIT = 2;

/** One screen of a book: the page record it uses (illustrations, text box) and the lines flowed into its box. */
export interface BookSpread {
  page: BookPage;
  lines: TextLine[];
}

/**
 * Flow a book's text into its pages. The text of the first page is poured into the text boxes of the pages in turn
 * (back to the first when it runs past the last), each box holding as many rows as fit its height. A book with no
 * text gives one spread per page so its pictures can still be seen.
 */
export function layoutBook(book: Book, font: Font): BookSpread[] {
  if (book.pages.length === 0) return [];
  const text = bookText(book);
  const rowH = font.height + 1;
  const first = book.pages[0]!;
  const width = Math.max(font.maxWidth, Math.floor(first.width / BOOK_UNIT));
  const lines = text ? wrapText(font, text, width) : [];
  if (lines.length === 0) return book.pages.map((page) => ({ page, lines: [] }));

  const spreads: BookSpread[] = [];
  let next = 0;
  for (let turn = 0; next < lines.length; turn++) {
    const page = book.pages[turn % book.pages.length]!;
    const rows = Math.max(1, Math.floor(page.height / BOOK_UNIT / rowH));
    const taken: TextLine[] = [];
    let used = 0;
    while (next < lines.length) {
      const l = lines[next]!;
      const cost = taken.length === 0 ? 1 : l.blankBefore ? 2 : 1;
      if (used + cost > rows && taken.length > 0) break;
      taken.push(taken.length === 0 ? { ...l, blankBefore: false } : l);
      used += cost;
      next++;
    }
    spreads.push({ page, lines: taken });
  }
  return spreads;
}
