/**
 * The intro's credits pages. CREDITS.SCX shows the first page already printed; the script then asks for pages 1 to
 * 20 (a dialogue op with key 0 and the page number). The remake lays the rest of CRED.DAT out over those pages in
 * the printed page's style: a heading on the left, its names on the right with a dotted leader, closing sentences
 * centred. The page breaks are our own.
 */

/** One printed line, in scene pixels: `y` is its top. */
export interface CreditRow {
  y: number;
  /** A heading, at the left edge. */
  left?: string;
  /** A name, against the right edge (with dots back to the heading when there is one). */
  right?: string;
  /** A sentence, centred. */
  centre?: string;
}

/** Where the printed page's text sits on CREDITS.SCX, in scene pixels. */
export const CREDITS_AREA = { left: 42, right: 276, top: 71, bottom: 161 } as const;
/** Lines of CRED.DAT that CREDITS.SCX already shows. */
export const PRINTED_LINES = 8;
/** Pages the intro script shows after the printed one. */
export const CREDIT_PAGE_COUNT = 20;
/** How long a page stays up (a click or Space moves on sooner). */
export const CREDIT_PAGE_SECONDS = 4;

/** Line and gap heights to try, tightest last, until the credits fit the pages. */
const SPACINGS = [
  { line: 10, gap: 5 },
  { line: 10, gap: 4 },
  { line: 9, gap: 4 },
  { line: 9, gap: 3 },
] as const;

function paginate(lines: readonly (readonly string[])[], line: number, gap: number): CreditRow[][] {
  const height = CREDITS_AREA.bottom - CREDITS_AREA.top;
  const pages: CreditRow[][] = [];
  let page: CreditRow[] = [];
  let y = 0;
  // A lone line lines up like the one before it: a name under a heading stays on the right, a sentence after a gap
  // is centred and so is the line that continues it.
  let right = false;
  for (const l of lines) {
    if (l.length === 0) {
      right = false;
      if (page.length) y += gap; // no gap at the top of a page
      continue;
    }
    if (y + line > height) {
      pages.push(page);
      page = [];
      y = 0;
    }
    const top = CREDITS_AREA.top + y;
    if (l.length >= 2) {
      page.push({ y: top, left: l[0], right: l.slice(1).join(' ') });
      right = true;
    } else if (right) {
      page.push({ y: top, right: l[0] });
    } else {
      page.push({ y: top, centre: l[0] });
    }
    y += line;
  }
  if (page.length) pages.push(page);
  return pages;
}

/** The pages after the printed one (index 0 is page 1), at the loosest spacing that fits `pageCount` pages. */
export function creditPages(lines: readonly (readonly string[])[], pageCount = CREDIT_PAGE_COUNT): CreditRow[][] {
  const rest = lines.slice(PRINTED_LINES);
  let pages: CreditRow[][] = [];
  for (const s of SPACINGS) {
    pages = paginate(rest, s.line, s.gap);
    if (pages.length <= pageCount) break;
  }
  return pages;
}
