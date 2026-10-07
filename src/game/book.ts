import { bookText, type Book, type BookPage } from '../formats/book';
import type { Font } from '../formats/fnt';
import { tokenizeText } from '../formats/textCodes';
import { wrapStyled, type TextLine } from '../ui/dialogBox';

/** Book coordinates are twice scene pixels. */
export const BOOK_UNIT = 2;

/** A line of a book spread; `indent` (scene pixels) leaves room beside an illustration such as a drop cap. */
export interface BookLine extends TextLine {
  indent?: number;
}

/** One screen of a book: the page record it uses (illustrations, text box) and the lines flowed into its box. */
export interface BookSpread {
  page: BookPage;
  lines: BookLine[];
}

/** Gap kept between an illustration and the text beside it, in scene pixels. */
const IMAGE_GAP = 2;

/**
 * Where text may go on one row of a page: the row's left indent and width (scene pixels, relative to the text box).
 * Pictures overlapping the row inside the box push the text aside: a picture in the left half indents it, one in the
 * right half narrows it. A picture that would leave less than a quarter of the width is ignored.
 */
export function rowSpace(page: BookPage, row: number, rowH: number, fontH: number, baseWidth: number, imageSize?: (index: number) => { width: number; height: number } | undefined): { indent: number; width: number } {
  let left = 0;
  let right = baseWidth;
  if (imageSize) {
    const boxX = page.x / BOOK_UNIT;
    const top = page.y / BOOK_UNIT + row * rowH;
    const bottom = top + fontH;
    for (const im of page.images) {
      const size = imageSize(im.image);
      if (!size) continue;
      const x0 = im.x / BOOK_UNIT - boxX;
      const x1 = x0 + size.width / BOOK_UNIT;
      const y0 = im.y / BOOK_UNIT;
      const y1 = y0 + size.height / BOOK_UNIT;
      if (y1 <= top || y0 >= bottom || x1 <= 0 || x0 >= baseWidth) continue;
      const centre = (x0 + x1) / 2;
      if (centre < baseWidth / 2) {
        const l = Math.max(left, Math.ceil(x1 + IMAGE_GAP));
        if (right - l >= baseWidth / 4) left = l;
      } else {
        const r = Math.min(right, Math.floor(x0 - IMAGE_GAP));
        if (r - left >= baseWidth / 4) right = r;
      }
    }
  }
  return { indent: left, width: right - left };
}

/**
 * Flow a book's text into its pages. The text of the first page is poured into the text boxes of the pages in turn
 * (back to the first when it runs past the last), each box holding as many rows as fit its height. Lines beside a
 * picture (see `rowSpace`) are indented or shortened, so an illuminated initial never sits under the text. A book
 * with no text gives one spread per page so its pictures can still be seen.
 */
export function layoutBook(book: Book, font: Font, imageSize?: (index: number) => { width: number; height: number } | undefined): BookSpread[] {
  if (book.pages.length === 0) return [];
  const text = bookText(book);
  const rowH = font.height + 1;
  const first = book.pages[0]!;
  const baseWidth = Math.max(font.maxWidth, Math.floor(first.width / BOOK_UNIT));
  const paragraphs = text ? tokenizeText(text) : [];
  if (paragraphs.length === 0) return book.pages.map((page) => ({ page, lines: [] }));

  const rowsOf = (page: BookPage) => Math.max(1, Math.floor(page.height / BOOK_UNIT / rowH));
  const spreads: BookSpread[] = [{ page: book.pages[0]!, lines: [] }];
  /** Rows used on the open spread. */
  let used = 0;
  /** Where the next line goes: whether it opens a new spread, and the row it takes. */
  const slot = (turn: number, usedRows: number, count: number, blankBefore: boolean) => {
    const page = book.pages[turn % book.pages.length]!;
    const cost = count === 0 ? 1 : blankBefore ? 2 : 1;
    if (count > 0 && usedRows + cost > rowsOf(page)) {
      const next = book.pages[(turn + 1) % book.pages.length]!;
      return { turn: turn + 1, page: next, row: 0, used: 1, fresh: true };
    }
    return { turn, page, row: count === 0 ? 0 : usedRows + (blankBefore ? 1 : 0), used: usedRows + cost, fresh: false };
  };
  let turn = 0;
  paragraphs.forEach((para, p) => {
    /** The open spread's state at the start of the paragraph; line j's space is worked out from it. */
    const start = { turn, used, count: spreads[spreads.length - 1]!.lines.length };
    const probe = (j: number) => {
      let t = start.turn, u = start.used, c = start.count;
      let s = slot(t, u, c, p > 0 && j === 0);
      for (let k = 1; k <= j; k++) {
        t = s.turn; u = s.used; c = s.fresh ? 1 : c + 1;
        s = slot(t, u, c, false);
      }
      return s;
    };
    const wrapped = wrapStyled(font, para, (j) => {
      const s = probe(j);
      return rowSpace(s.page, s.row, rowH, font.height, baseWidth, imageSize).width;
    });
    wrapped.forEach((runs, j) => {
      const blankBefore = p > 0 && j === 0;
      const cur = spreads[spreads.length - 1]!;
      const s = slot(turn, used, cur.lines.length, blankBefore);
      let target = cur;
      if (s.fresh) {
        target = { page: s.page, lines: [] };
        spreads.push(target);
      }
      turn = s.turn;
      used = s.used;
      const space = rowSpace(s.page, s.row, rowH, font.height, baseWidth, imageSize);
      const line: BookLine = { text: runs.map((r) => r.text).join(''), runs, blankBefore: target.lines.length > 0 && blankBefore };
      if (space.indent > 0) line.indent = space.indent;
      target.lines.push(line);
    });
  });
  return spreads[0]!.lines.length === 0 ? book.pages.map((page) => ({ page, lines: [] })) : spreads;
}
