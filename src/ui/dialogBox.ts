import type { DialogSnippet } from '../formats/ddx';
import { glyphFor, measureString, type Font } from '../formats/fnt';
import {
  PLAIN_STYLE,
  sameStyle,
  tokenizeText,
  type StyledParagraph,
  type StyledRun,
  type TextStyle,
} from '../formats/textCodes';
import { drawSpeakerName, fitSpeakerName } from './speakerFont';

/** HUD canvas size (16:9). */
export const HUD_WIDTH = 2560;
export const HUD_HEIGHT = 1440;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoxLayoutOptions {
  /** Integer pixel-font scale factor (>= 1). */
  scale: number;
  /** Outer box in canvas pixels. */
  box: Rect;
  /** Inner padding in canvas pixels. */
  padding: number;
  /** Extra font-pixel gap between glyphs. */
  spacing?: number;
  /** Extra font-pixel gap between lines (default 1). */
  lineGap?: number;
  /** Extra font-pixel gap added between paragraphs (default = one line). */
  paragraphGap?: number;
}

/** Largest integer scale at which a font-height of `fontHeight` x `rows` rows fits in the HUD height share. */
export function chooseScale(canvasHeight: number, designHeight = 360): number {
  return Math.max(1, Math.floor(canvasHeight / designHeight));
}

/** Default dialogue box: bottom-centre, 60% wide, 30% tall, at an integer scale for the canvas. */
export function defaultBoxOptions(canvasWidth = HUD_WIDTH, canvasHeight = HUD_HEIGHT): BoxLayoutOptions {
  const scale = chooseScale(canvasHeight);
  const width = Math.floor(canvasWidth * 0.6);
  const height = Math.floor(canvasHeight * 0.3);
  return {
    scale,
    box: {
      x: Math.floor((canvasWidth - width) / 2),
      y: canvasHeight - height - Math.floor(canvasHeight * 0.04),
      width,
      height,
    },
    padding: 8 * scale,
  };
}

/** Paragraph texts with control codes removed. */
export function splitParagraphs(text: string): string[] {
  return tokenizeText(text).map((p) => p.map((r) => r.text).join(''));
}

interface Cell {
  ch: string;
  style: TextStyle;
}

function toCells(paragraph: StyledParagraph): Cell[] {
  const cells: Cell[] = [];
  for (const run of paragraph) for (const ch of run.text) cells.push({ ch, style: run.style });
  return cells;
}

function cellsToRuns(cells: Cell[]): StyledRun[] {
  const runs: StyledRun[] = [];
  for (const c of cells) {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last.style, c.style)) last.text += c.ch;
    else runs.push({ text: c.ch, style: c.style });
  }
  return runs;
}

const text = (cells: Cell[]) => cells.map((c) => c.ch).join('');

/** Greedy word-wrap of one styled paragraph. '\n' inside a run forces a line break. Over-long words are broken per character. */
export function wrapStyled(
  font: Font,
  paragraph: StyledParagraph,
  maxWidth: number | ((lineIndex: number) => number),
  spacing = 0,
): StyledRun[][] {
  const lines: Cell[][] = [];
  let line: Cell[] = [];
  const widthAt = typeof maxWidth === 'number' ? () => maxWidth : maxWidth;
  const fits = (cells: Cell[]) => measureString(font, text(cells), spacing) <= widthAt(lines.length);
  const words: Cell[][] = [];
  let word: Cell[] = [];
  const endWord = () => {
    if (word.length > 0) words.push(word);
    word = [];
  };
  for (const c of toCells(paragraph)) {
    if (c.ch === '\n') {
      endWord();
      words.push([]); // forced break marker
    } else if (/\s/.test(c.ch)) endWord();
    else word.push(c);
  }
  endWord();

  const space = (w: Cell[]): Cell => ({ ch: ' ', style: w[0]!.style });
  for (const w of words) {
    if (w.length === 0) {
      lines.push(line);
      line = [];
      continue;
    }
    const candidate = line.length === 0 ? w : [...line, space(w), ...w];
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line.length > 0) lines.push(line);
    let rest = w;
    while (!fits(rest) && rest.length > 1) {
      let n = 1;
      while (n < rest.length && fits(rest.slice(0, n + 1))) n++;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line.length > 0) lines.push(line);
  return lines.map(cellsToRuns);
}

/** Greedy word-wrap of one plain paragraph to `maxWidth` font pixels. */
export function wrapParagraph(font: Font, text: string, maxWidth: number, spacing = 0): string[] {
  return wrapStyled(font, [{ text, style: { ...PLAIN_STYLE } }], maxWidth, spacing).map((l) =>
    l.map((r) => r.text).join(''),
  );
}

/** A wrapped text line; `blankBefore` marks the first line of a paragraph other than the first. */
export interface TextLine {
  text: string;
  blankBefore: boolean;
  /** Styled runs making up `text`; absent means one plain run. */
  runs?: StyledRun[];
}

export function wrapText(font: Font, rawText: string, maxWidth: number, spacing = 0): TextLine[] {
  const out: TextLine[] = [];
  tokenizeText(rawText).forEach((para, i) => {
    wrapStyled(font, para, maxWidth, spacing).forEach((runs, j) => {
      out.push({ text: runs.map((r) => r.text).join(''), runs, blankBefore: i > 0 && j === 0 });
    });
  });
  return out;
}

/** Split lines into pages of at most `rows` rows; paragraph gaps cost a row (and are dropped at a page top). */
export function paginate(lines: TextLine[], rows: number): TextLine[][] {
  const budget = Math.max(1, rows);
  const pages: TextLine[][] = [];
  let page: TextLine[] = [];
  let used = 0;
  for (const l of lines) {
    let line = l;
    let cost = line.blankBefore ? 2 : 1;
    if (used + cost > budget && page.length > 0) {
      pages.push(page);
      page = [];
      used = 0;
      line = { ...line, blankBefore: false };
      cost = 1;
    }
    page.push(line);
    used += cost;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

export interface ChoiceSlot {
  index: number;
  label: string;
  /** Canvas-pixel rectangle (hit area). */
  rect: Rect;
}

/** Who speaks a snippet: the name titles the box, the portrait stands above it. */
export interface SpeakerInfo {
  name: string;
  /** Portrait size in source pixels; absent when the actor has no portrait. */
  portrait?: { width: number; height: number };
}

/** Gap between a portrait's bottom and the box top, and between the title and the text, in scaled pixels. */
const SPEAKER_GAP = 2;

export interface DialogLayout {
  box: Rect;
  scale: number;
  /** Text rows available per page after reserving space for choices. */
  rowsPerPage: number;
  pages: TextLine[][];
  /** Canvas-pixel rect of the text area. */
  textArea: Rect;
  choices: ChoiceSlot[];
  /** Speaker name at the top of the box (canvas pixels; centred in `box`). */
  title?: { text: string; x: number; y: number; fontSizePx: number };
  /** Canvas-pixel rect the speaker's portrait is drawn into, standing on the top edge of the box. */
  portrait?: Rect;
}

/**
 * Lay a snippet out. `choiceLabels` supplies display text for each choice (keyword strings live in
 * other files, so the caller resolves them). Choices are placed in a grid under the text, shown with
 * the last page only; query snippets (displayStyle3 bit 0x2) are laid out in a single row.
 */
export function layoutDialog(
  font: Font,
  snippet: Pick<DialogSnippet, 'text' | 'displayStyle3'>,
  choiceLabels: string[],
  opts: BoxLayoutOptions,
  speaker?: SpeakerInfo,
): DialogLayout {
  const { scale, box, padding } = opts;
  const spacing = opts.spacing ?? 0;
  const lineGap = opts.lineGap ?? 1;
  const rowH = (font.height + lineGap) * scale;
  const innerW = box.width - 2 * padding;
  // A speaker's name takes the first row of the box; the text starts below it.
  const titleH = speaker ? rowH + SPEAKER_GAP * scale : 0;
  const innerH = box.height - 2 * padding - titleH;
  const maxWidth = Math.floor(innerW / scale);
  const textArea: Rect = { x: box.x + padding, y: box.y + padding + titleH, width: innerW, height: innerH };

  const isQuery = (snippet.displayStyle3 & 0x2) !== 0;
  const columns =
    choiceLabels.length === 0
      ? 0
      : isQuery
        ? choiceLabels.length
        : choiceColumns(font, choiceLabels, maxWidth, spacing);
  const choiceRows = columns === 0 ? 0 : Math.ceil(choiceLabels.length / columns);
  const totalRows = Math.max(1, Math.floor(innerH / rowH));
  // Keep at least two text rows even when many choices; choices only appear on the last page.
  const rowsPerPage = Math.max(1, totalRows - choiceRows - (choiceRows > 0 ? 1 : 0));

  const pages = paginate(wrapText(font, snippet.text, maxWidth, spacing), rowsPerPage);
  if (pages.length === 0) pages.push([]);

  const choices: ChoiceSlot[] = [];
  if (columns > 0) {
    const colW = Math.floor(innerW / columns);
    const top = box.y + box.height - padding - choiceRows * rowH;
    choiceLabels.forEach((label, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      choices.push({
        index,
        label,
        rect: { x: textArea.x + col * colW, y: top + row * rowH, width: colW, height: rowH },
      });
    });
  }
  const layout: DialogLayout = { box, scale, rowsPerPage, pages, textArea, choices };
  if (speaker) {
    // Calculate Cinzel font size for the speaker name
    // Target: cap height roughly 1.6x the bitmap font's height
    const targetFontSizePx = Math.floor(font.height * 1.6 * scale);
    const maxWidth = box.width - 2 * padding;
    const { size: fontSizePx } = fitSpeakerName(speaker.name, maxWidth, targetFontSizePx);

    layout.title = {
      text: speaker.name,
      x: box.x + Math.floor(box.width / 2), // centred; actual centering done by drawSpeakerName
      y: box.y + padding + Math.floor((rowH - fontSizePx) / 2), // vertically centred in title row
      fontSizePx,
    };
    const p = speaker.portrait;
    if (p && p.width > 0 && p.height > 0) {
      const room = box.y - SPEAKER_GAP * scale;
      let s = scale;
      while (s > 1 && p.height * s > room) s--;
      const width = p.width * s;
      const height = p.height * s;
      layout.portrait = {
        x: box.x + Math.floor((box.width - width) / 2),
        y: Math.max(0, box.y - SPEAKER_GAP * scale - height),
        width,
        height,
      };
    }
  }
  return layout;
}

/** Columns for a choice grid: as many as fit with the widest label, capped at 3. */
export function choiceColumns(font: Font, labels: string[], maxWidth: number, spacing = 0): number {
  const widest = Math.max(...labels.map((l) => measureString(font, `> ${l}`, spacing))) + 4;
  return Math.max(1, Math.min(3, labels.length, Math.floor(maxWidth / widest)));
}

export type DialogEvent =
  { type: 'key'; key: string } | { type: 'click'; x: number; y: number } | { type: 'hover'; x: number; y: number };

export interface DialogState {
  page: number;
  /** Selected choice index, or -1 when none yet / no choices. */
  selected: number;
}

/** `cancel`: the dialogue was closed from outside (Esc, another screen) rather than answered. */
export type DialogResult =
  { kind: 'none' } | { kind: 'choose'; index: number } | { kind: 'finish' } | { kind: 'cancel' };

export function initialState(layout: DialogLayout): DialogState {
  return { page: 0, selected: layout.choices.length > 0 ? 0 : -1 };
}

export function choiceAt(layout: DialogLayout, x: number, y: number): number {
  const hit = layout.choices.find(({ rect: r }) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  return hit ? hit.index : -1;
}

/** Whether choices are currently visible/selectable (last page only). */
export function choicesActive(layout: DialogLayout, state: DialogState): boolean {
  return layout.choices.length > 0 && state.page >= layout.pages.length - 1;
}

/**
 * Pure input reducer. Keys: Enter/Space advance a page, choose the selected choice, or finish a
 * choice-less snippet. Arrows / WASD move the selection (grid-aware). Digits 1-9 pick a choice
 * directly. Clicks pick a choice or advance; hover moves the selection.
 */
export function step(
  layout: DialogLayout,
  state: DialogState,
  ev: DialogEvent,
): { state: DialogState; result: DialogResult } {
  const last = layout.pages.length - 1;
  const active = choicesActive(layout, state);
  const none: DialogResult = { kind: 'none' };
  const advance = (): { state: DialogState; result: DialogResult } => {
    if (state.page < last) return { state: { ...state, page: state.page + 1 }, result: none };
    if (layout.choices.length > 0)
      return { state, result: state.selected >= 0 ? { kind: 'choose', index: state.selected } : none };
    return { state, result: { kind: 'finish' } };
  };

  if (ev.type === 'click') {
    if (active) {
      const i = choiceAt(layout, ev.x, ev.y);
      if (i >= 0) return { state: { ...state, selected: i }, result: { kind: 'choose', index: i } };
      return { state, result: none };
    }
    return advance();
  }
  if (ev.type === 'hover') {
    if (!active) return { state, result: none };
    const i = choiceAt(layout, ev.x, ev.y);
    return { state: i >= 0 ? { ...state, selected: i } : state, result: none };
  }

  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  if (key === 'Enter' || key === ' ') return advance();
  if (active) {
    const n = layout.choices.length;
    const cols = columnsOf(layout);
    const sel = state.selected < 0 ? 0 : state.selected;
    let next = sel;
    if (key === 'ArrowLeft' || key === 'a') next = Math.max(0, sel - 1);
    else if (key === 'ArrowRight' || key === 'd') next = Math.min(n - 1, sel + 1);
    else if (key === 'ArrowUp' || key === 'w') next = sel - cols >= 0 ? sel - cols : sel;
    else if (key === 'ArrowDown' || key === 's') next = sel + cols < n ? sel + cols : sel;
    else if (/^[1-9]$/.test(key) && Number(key) <= n) {
      const index = Number(key) - 1;
      return { state: { ...state, selected: index }, result: { kind: 'choose', index } };
    } else return { state, result: none };
    return { state: { ...state, selected: next }, result: none };
  }
  if (key === 'ArrowDown' || key === 's' || key === 'ArrowRight' || key === 'd') {
    return { state: { ...state, page: Math.min(last, state.page + 1) }, result: none };
  }
  if (key === 'ArrowUp' || key === 'w' || key === 'ArrowLeft' || key === 'a') {
    return { state: { ...state, page: Math.max(0, state.page - 1) }, result: none };
  }
  return { state, result: none };
}

function columnsOf(layout: DialogLayout): number {
  const first = layout.choices[0];
  if (!first) return 1;
  return Math.max(1, layout.choices.filter((c) => c.rect.y === first.rect.y).length);
}

export interface DialogColors {
  background: string;
  border: string;
  text: string;
  choice: string;
  selected: string;
  more: string;
  emphasis: string;
  italic: string;
  red: string;
  white: string;
  inactive: string;
  moredhel: string;
}

export const DEFAULT_COLORS: DialogColors = {
  background: 'rgba(24, 16, 8, 0.92)',
  border: '#c8a050',
  text: '#f0e0b8',
  choice: '#d8c090',
  selected: '#ffffff',
  more: '#c8a050',
  emphasis: '#ffe060',
  italic: '#a08860',
  red: '#e05040',
  white: '#ffffff',
  inactive: '#706850',
  moredhel: '#80c0a0',
};

/** Pick the draw colour for a run; later flags win (inactive > moredhel > red > white > emphasis > italic). */
export function runColor(style: TextStyle, colors: DialogColors): string {
  if (style.inactive) return colors.inactive;
  if (style.moredhel) return colors.moredhel;
  if (style.red) return colors.red;
  if (style.white) return colors.white;
  if (style.emphasis) return colors.emphasis;
  if (style.italic || style.unbold) return colors.italic;
  return colors.text;
}

/**
 * Rasterise `text` into an RGBA buffer at an integer `scale` (nearest-neighbour). Pure: returns
 * the pixels so it can be tested without a canvas. `color` is [r,g,b,a].
 */
export function rasterizeText(
  font: Font,
  text: string,
  scale: number,
  color: [number, number, number, number],
  spacing = 0,
) {
  const width = Math.max(1, measureString(font, text, spacing)) * scale;
  const height = font.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  let x = 0;
  for (let i = 0; i < text.length; i++) {
    const g = glyphFor(font, text.charCodeAt(i));
    for (let gy = 0; gy < g.height; gy++) {
      for (let gx = 0; gx < g.width; gx++) {
        if (g.pixels[gy * g.width + gx] === 0) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const o = ((gy * scale + sy) * width + (x + gx) * scale + sx) * 4;
            data[o] = color[0];
            data[o + 1] = color[1];
            data[o + 2] = color[2];
            data[o + 3] = color[3];
          }
        }
      }
    }
    x += g.width + spacing;
  }
  return { width, height, data };
}

/** Draw glyph pixels with fillRect (horizontal runs) so unset pixels stay transparent; putImageData would overwrite the box background with them. */
function drawText(
  ctx: CanvasRenderingContext2D,
  font: Font,
  text: string,
  x: number,
  y: number,
  scale: number,
  css: string,
  spacing: number,
) {
  if (text === '') return;
  ctx.fillStyle = css;
  let gx = x;
  for (let i = 0; i < text.length; i++) {
    const g = glyphFor(font, text.charCodeAt(i));
    for (let py = 0; py < g.height; py++) {
      let start = -1;
      for (let px = 0; px <= g.width; px++) {
        const on = px < g.width && g.pixels[py * g.width + px] !== 0;
        if (on && start < 0) start = px;
        else if (!on && start >= 0) {
          ctx.fillRect(gx + start * scale, y + py * scale, (px - start) * scale, scale);
          start = -1;
        }
      }
    }
    gx += (g.width + spacing) * scale;
  }
}

/** Draw the current page of a laid-out dialogue. Glyphs are integer-scaled rectangles, so scaling stays crisp. */
export function drawDialog(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: DialogLayout,
  state: DialogState,
  opts: { spacing?: number; lineGap?: number; colors?: DialogColors; portrait?: CanvasImageSource } = {},
): void {
  const colors = opts.colors ?? DEFAULT_COLORS;
  const spacing = opts.spacing ?? 0;
  const lineGap = opts.lineGap ?? 1;
  const { box, scale, textArea } = layout;
  const rowH = (font.height + lineGap) * scale;

  if (layout.portrait && opts.portrait) {
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const r = layout.portrait;
    ctx.drawImage(opts.portrait, r.x, r.y, r.width, r.height);
    ctx.imageSmoothingEnabled = smoothing;
  }
  ctx.fillStyle = colors.background;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(box.x + scale / 2, box.y + scale / 2, box.width - scale, box.height - scale);

  if (layout.title) {
    const t = layout.title;
    // Draw speaker name with Cinzel font
    drawSpeakerName(
      ctx,
      t.text,
      t.x,
      t.y + Math.floor(t.fontSizePx * 0.8), // baseline adjustment for Cinzel
      t.fontSizePx,
      colors.emphasis, // gold fill
      'rgba(0, 0, 0, 0.8)', // dark outline
      Math.max(1, Math.floor(t.fontSizePx * 0.08)), // outline width proportional to font size
    );
  }

  let y = textArea.y;
  for (const line of layout.pages[state.page] ?? []) {
    if (line.blankBefore) y += rowH;
    let x = textArea.x;
    for (const run of line.runs ?? [{ text: line.text, style: PLAIN_STYLE }]) {
      const color = runColor(run.style, colors);
      drawText(ctx, font, run.text, x, y, scale, color, spacing);
      if (run.style.bold && !run.style.unbold) drawText(ctx, font, run.text, x + scale, y, scale, color, spacing);
      x += (measureString(font, run.text, spacing) + spacing) * scale;
    }
    y += rowH;
  }

  if (choicesActive(layout, state)) {
    for (const c of layout.choices) {
      const sel = c.index === state.selected;
      drawText(
        ctx,
        font,
        `${sel ? '>' : ' '} ${c.label}`,
        c.rect.x,
        c.rect.y,
        scale,
        sel ? colors.selected : colors.choice,
        spacing,
      );
    }
  } else if (state.page < layout.pages.length - 1) {
    drawText(
      ctx,
      font,
      '...',
      box.x + box.width - 16 * scale - padding(layout),
      box.y + box.height - rowH - scale,
      scale,
      colors.more,
      spacing,
    );
  }
}

function padding(layout: DialogLayout): number {
  return layout.textArea.x - layout.box.x;
}
