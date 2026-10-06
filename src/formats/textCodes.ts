/**
 * Dialogue text control codes. DDX text (and other in-game strings) mixes printable Latin-1 with
 * formatting bytes. This module turns raw text into paragraphs of styled runs so control bytes are
 * never drawn as glyphs. Semantics follow what BaKGL's text box does (read for understanding only);
 * see docs/formats/dialogue.md section 6.
 */

/** Style flags active for a run of characters. All default to false. */
export interface TextStyle {
  /** '#' toggles; a tab turns it off. */
  bold: boolean;
  /** 0xF0 / 0xF1 switch on; cleared by the next space or line end. Drawn highlighted. */
  emphasis: boolean;
  /** 0xF3 switches on; cleared by the next space or line end. Drawn in a lowlight colour. */
  italic: boolean;
  /** 0xF4 toggles (muted). */
  unbold: boolean;
  /** 0xF9 toggles (greyed out). */
  inactive: boolean;
  /** 0xF5 toggles. */
  red: boolean;
  /** 0xF6 toggles. */
  white: boolean;
  /** 0xF7 toggles Moredhel script styling. */
  moredhel: boolean;
}

export interface StyledRun {
  text: string;
  style: TextStyle;
}

/** A paragraph: runs plus forced line breaks (0xF8) as '\n' characters inside run text. */
export type StyledParagraph = StyledRun[];

export const PLAIN_STYLE: Readonly<TextStyle> = Object.freeze({
  bold: false,
  emphasis: false,
  italic: false,
  unbold: false,
  inactive: false,
  red: false,
  white: false,
  moredhel: false,
});

export const CODE_PARAGRAPH = 0x0a; // '\n'
export const CODE_BOLD = 0x23; // '#'
export const CODE_EMPHASIS_A = 0xf0;
export const CODE_EMPHASIS_B = 0xf1;
export const CODE_ITALIC = 0xf3;
export const CODE_UNBOLD = 0xf4;
export const CODE_RED = 0xf5;
export const CODE_WHITE = 0xf6;
export const CODE_MOREDHEL = 0xf7;
export const CODE_HALF_LINE = 0xf8;
export const CODE_INACTIVE = 0xf9;

export function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return (
    a.bold === b.bold && a.emphasis === b.emphasis && a.italic === b.italic && a.unbold === b.unbold &&
    a.inactive === b.inactive && a.red === b.red && a.white === b.white && a.moredhel === b.moredhel
  );
}

/** Whether a style draws differently from plain text. */
export function isPlain(style: TextStyle): boolean {
  return sameStyle(style, PLAIN_STYLE);
}

/** Bytes that are consumed silently (never drawn): C0 controls other than the ones handled, and 0xF2, 0xFA-0xFF. */
function isIgnoredControl(code: number): boolean {
  if (code < 0x20) return true;
  return code === 0xf2 || (code >= 0xfa && code <= 0xff) || code === 0x7f;
}

/**
 * Tokenise DDX text. `'\n'` starts a new paragraph (empty paragraphs are dropped); `'#'` toggles
 * bold; 0xF8 forces a line break inside the paragraph. A tab is four spaces and clears bold, the
 * book-decoration spaces 0xE1-0xE3 become ordinary spaces. A space or paragraph end clears
 * emphasis and italic; a paragraph end also clears unbold, inactive, red, white and Moredhel
 * (bold carries over, as in the original).
 */
export function tokenizeText(text: string): StyledParagraph[] {
  const paragraphs: StyledParagraph[] = [];
  let runs: StyledRun[] = [];
  let style: TextStyle = { ...PLAIN_STYLE };
  let buf = '';

  const flush = () => {
    if (buf !== '') runs.push({ text: buf, style: { ...style } });
    buf = '';
  };
  const endParagraph = () => {
    flush();
    const visible = runs.some((r) => r.text.trim() !== '');
    if (visible) paragraphs.push(trimRuns(runs));
    runs = [];
    style = { ...style, emphasis: false, italic: false, unbold: false, inactive: false, red: false, white: false, moredhel: false };
  };
  const set = (patch: Partial<TextStyle>) => {
    flush();
    style = { ...style, ...patch };
  };

  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    switch (c) {
      case CODE_PARAGRAPH: endParagraph(); break;
      case CODE_BOLD: set({ bold: !style.bold }); break;
      case CODE_EMPHASIS_A:
      case CODE_EMPHASIS_B: set({ emphasis: true }); break;
      case CODE_ITALIC: set({ italic: true }); break;
      case CODE_UNBOLD: set({ unbold: !style.unbold }); break;
      case CODE_RED: set({ red: !style.red }); break;
      case CODE_WHITE: set({ white: !style.white }); break;
      case CODE_MOREDHEL: set({ moredhel: !style.moredhel }); break;
      case CODE_INACTIVE: set({ inactive: !style.inactive }); break;
      case CODE_HALF_LINE: buf += '\n'; break;
      case 0x09:
        buf += '    ';
        set({ bold: false });
        break;
      case 0x20:
      case 0xe1:
      case 0xe2:
      case 0xe3:
        buf += ' ';
        if (style.emphasis || style.italic) set({ emphasis: false, italic: false });
        break;
      default:
        if (!isIgnoredControl(c)) buf += text[i];
    }
  }
  endParagraph();
  return paragraphs;
}

/** Trim leading/trailing whitespace across runs and merge adjacent runs of equal style. */
function trimRuns(runs: StyledRun[]): StyledRun[] {
  const out: StyledRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && sameStyle(last.style, r.style)) last.text += r.text;
    else out.push({ text: r.text, style: r.style });
  }
  while (out.length > 0 && out[0]!.text.trimStart() === '') out.shift();
  while (out.length > 0 && out[out.length - 1]!.text.trimEnd() === '') out.pop();
  if (out.length > 0) {
    out[0]!.text = out[0]!.text.trimStart();
    out[out.length - 1]!.text = out[out.length - 1]!.text.trimEnd();
  }
  return out;
}

/** Text with every control code removed (what a plain-text consumer should show). */
export function stripTextCodes(text: string): string {
  return tokenizeText(text).map((p) => p.map((r) => r.text).join('')).join('\n');
}
