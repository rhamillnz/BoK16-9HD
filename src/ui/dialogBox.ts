import type { DialogSnippet } from '../formats/ddx';
import { glyphFor, measureString, type Font } from '../formats/fnt';

/** HUD canvas size (16:9). */
export const HUD_WIDTH = 2560;
export const HUD_HEIGHT = 1440;

/** Characters in DDX text that start a new paragraph (BaKGL uses '#'; '\n' is accepted too). */
const PARAGRAPH_BREAK = /[#\n]/;

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

export function splitParagraphs(text: string): string[] {
  return text.split(PARAGRAPH_BREAK).map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Greedy word-wrap of one paragraph to `maxWidth` font pixels. Over-long words are broken per character. */
export function wrapParagraph(font: Font, text: string, maxWidth: number, spacing = 0): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (measureString(font, candidate, spacing) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    line = '';
    let rest = word;
    while (measureString(font, rest, spacing) > maxWidth && rest.length > 1) {
      let n = 1;
      while (n < rest.length && measureString(font, rest.slice(0, n + 1), spacing) <= maxWidth) n++;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** A wrapped text line; `blankBefore` marks the first line of a paragraph other than the first. */
export interface TextLine {
  text: string;
  blankBefore: boolean;
}

export function wrapText(font: Font, text: string, maxWidth: number, spacing = 0): TextLine[] {
  const out: TextLine[] = [];
  splitParagraphs(text).forEach((para, i) => {
    wrapParagraph(font, para, maxWidth, spacing).forEach((line, j) => {
      out.push({ text: line, blankBefore: i > 0 && j === 0 });
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
      line = { text: line.text, blankBefore: false };
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

export interface DialogLayout {
  box: Rect;
  scale: number;
  /** Text rows available per page after reserving space for choices. */
  rowsPerPage: number;
  pages: TextLine[][];
  /** Canvas-pixel rect of the text area. */
  textArea: Rect;
  choices: ChoiceSlot[];
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
): DialogLayout {
  const { scale, box, padding } = opts;
  const spacing = opts.spacing ?? 0;
  const lineGap = opts.lineGap ?? 1;
  const rowH = (font.height + lineGap) * scale;
  const innerW = box.width - 2 * padding;
  const innerH = box.height - 2 * padding;
  const maxWidth = Math.floor(innerW / scale);
  const textArea: Rect = { x: box.x + padding, y: box.y + padding, width: innerW, height: innerH };

  const isQuery = (snippet.displayStyle3 & 0x2) !== 0;
  const columns = choiceLabels.length === 0 ? 0 : isQuery ? choiceLabels.length : choiceColumns(font, choiceLabels, maxWidth, spacing);
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
      choices.push({ index, label, rect: { x: textArea.x + col * colW, y: top + row * rowH, width: colW, height: rowH } });
    });
  }
  return { box, scale, rowsPerPage, pages, textArea, choices };
}

/** Columns for a choice grid: as many as fit with the widest label, capped at 3. */
export function choiceColumns(font: Font, labels: string[], maxWidth: number, spacing = 0): number {
  const widest = Math.max(...labels.map((l) => measureString(font, `> ${l}`, spacing))) + 4;
  return Math.max(1, Math.min(3, labels.length, Math.floor(maxWidth / widest)));
}

export type DialogEvent =
  | { type: 'key'; key: string }
  | { type: 'click'; x: number; y: number }
  | { type: 'hover'; x: number; y: number };

export interface DialogState {
  page: number;
  /** Selected choice index, or -1 when none yet / no choices. */
  selected: number;
}

export type DialogResult = { kind: 'none' } | { kind: 'choose'; index: number } | { kind: 'finish' };

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
export function step(layout: DialogLayout, state: DialogState, ev: DialogEvent): { state: DialogState; result: DialogResult } {
  const last = layout.pages.length - 1;
  const active = choicesActive(layout, state);
  const none: DialogResult = { kind: 'none' };
  const advance = (): { state: DialogState; result: DialogResult } => {
    if (state.page < last) return { state: { ...state, page: state.page + 1 }, result: none };
    if (layout.choices.length > 0) return { state, result: state.selected >= 0 ? { kind: 'choose', index: state.selected } : none };
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
}

export const DEFAULT_COLORS: DialogColors = {
  background: 'rgba(24, 16, 8, 0.92)',
  border: '#c8a050',
  text: '#f0e0b8',
  choice: '#d8c090',
  selected: '#ffffff',
  more: '#c8a050',
};

/**
 * Rasterise `text` into an RGBA buffer at an integer `scale` (nearest-neighbour). Pure: returns
 * the pixels so it can be tested without a canvas. `color` is [r,g,b,a].
 */
export function rasterizeText(font: Font, text: string, scale: number, color: [number, number, number, number], spacing = 0) {
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
            const o = (((gy * scale + sy) * width) + (x + gx) * scale + sx) * 4;
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

function parseColor(ctx: CanvasRenderingContext2D, css: string): [number, number, number, number] {
  const prev = ctx.fillStyle;
  ctx.fillStyle = css;
  const resolved = String(ctx.fillStyle);
  ctx.fillStyle = prev;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(resolved);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16), 255];
  const rgba = /rgba?\(([^)]+)\)/.exec(resolved);
  const p = rgba ? rgba[1]!.split(',').map((s) => parseFloat(s)) : [255, 255, 255, 1];
  return [p[0]!, p[1]!, p[2]!, Math.round((p[3] ?? 1) * 255)];
}

function drawText(ctx: CanvasRenderingContext2D, font: Font, text: string, x: number, y: number, scale: number, css: string, spacing: number) {
  if (text === '') return;
  const img = rasterizeText(font, text, scale, parseColor(ctx, css), spacing);
  ctx.putImageData(new ImageData(img.data, img.width, img.height), x, y);
}

/** Draw the current page of a laid-out dialogue. putImageData ignores smoothing, so scaling stays crisp. */
export function drawDialog(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: DialogLayout,
  state: DialogState,
  opts: { spacing?: number; lineGap?: number; colors?: DialogColors } = {},
): void {
  const colors = opts.colors ?? DEFAULT_COLORS;
  const spacing = opts.spacing ?? 0;
  const lineGap = opts.lineGap ?? 1;
  const { box, scale, textArea } = layout;
  const rowH = (font.height + lineGap) * scale;

  ctx.fillStyle = colors.background;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(box.x + scale / 2, box.y + scale / 2, box.width - scale, box.height - scale);

  let y = textArea.y;
  for (const line of layout.pages[state.page] ?? []) {
    if (line.blankBefore) y += rowH;
    drawText(ctx, font, line.text, textArea.x, y, scale, colors.text, spacing);
    y += rowH;
  }

  if (choicesActive(layout, state)) {
    for (const c of layout.choices) {
      const sel = c.index === state.selected;
      drawText(ctx, font, `${sel ? '>' : ' '} ${c.label}`, c.rect.x, c.rect.y, scale, sel ? colors.selected : colors.choice, spacing);
    }
  } else if (state.page < layout.pages.length - 1) {
    drawText(ctx, font, '...', box.x + box.width - 16 * scale - padding(layout), box.y + box.height - rowH - scale, scale, colors.more, spacing);
  }
}

function padding(layout: DialogLayout): number {
  return layout.textArea.x - layout.box.x;
}
