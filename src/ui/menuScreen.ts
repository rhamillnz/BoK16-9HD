import { glyphFor, type Font } from '../formats/fnt';
import { HUD_HEIGHT, HUD_WIDTH, chooseScale, type Rect } from './dialogBox';

/**
 * A small generic panel: a title, some lines of text, a list of rows to choose from and a row of
 * buttons. The temple screens (cure, bless, teleport) are all built from it. Pure layout and
 * stepping so it can be tested without a canvas; `drawMenuScreen` paints it.
 * Up/Down move the highlight, Enter or Space picks it, a click picks what is under the pointer.
 */

export interface MenuItem {
  id: string;
  label: string;
  /** Right-aligned extra text (a price, say). */
  detail?: string;
  /** Disabled items are drawn dimmed and cannot be picked. Default true. */
  enabled?: boolean;
}

export interface MenuModel {
  title: string;
  lines: string[];
  rows: MenuItem[];
  buttons: MenuItem[];
  /** One line of feedback under the rows ("Not enough money"). */
  message?: string;
}

export interface MenuLayout {
  scale: number;
  panel: Rect;
  title: Rect;
  lines: Rect[];
  rows: Rect[];
  buttons: Rect[];
  message: Rect;
}

export interface MenuState {
  /** Highlighted entry, counting rows first, then buttons. */
  focus: number;
}

export type MenuEvent = { type: 'key'; key: string } | { type: 'click' | 'hover'; x: number; y: number };
export type MenuResult = { kind: 'none' } | { kind: 'pick'; id: string };

export function layoutMenu(model: MenuModel, width = HUD_WIDTH, height = HUD_HEIGHT): MenuLayout {
  const scale = chooseScale(height);
  const unit = scale * 10;
  const rowH = unit * 1.6;
  const pad = unit;
  const panelW = Math.min(width, 120 * unit);
  const innerW = panelW - 2 * pad;
  const lineH = unit * 1.3;
  const btnW = Math.min(innerW, 26 * unit);
  const panelH = Math.ceil(
    pad + unit * 2 + model.lines.length * lineH + (model.lines.length ? unit : 0) + model.rows.length * rowH + (model.rows.length ? unit : 0) + unit * 1.5 + unit * 2 + unit * 2 + pad,
  );
  const panel: Rect = { x: Math.floor((width - panelW) / 2), y: Math.floor((height - Math.min(panelH, height)) / 2), width: panelW, height: Math.min(panelH, height) };
  let y = panel.y + pad;
  const title: Rect = { x: panel.x + pad, y, width: innerW, height: unit };
  y += unit * 2;
  const lines = model.lines.map((_, i) => ({ x: panel.x + pad, y: y + i * lineH, width: innerW, height: unit }));
  y += model.lines.length * lineH + (model.lines.length ? unit : 0);
  const rows = model.rows.map((_, i) => ({ x: panel.x + pad, y: y + i * rowH, width: innerW, height: rowH - scale * 2 }));
  y += model.rows.length * rowH + (model.rows.length ? unit : 0);
  const message: Rect = { x: panel.x + pad, y, width: innerW, height: unit };
  y += unit * 2;
  const buttons = model.buttons.map((_, i) => ({ x: panel.x + pad + i * (btnW + unit / 2), y, width: btnW, height: unit * 1.5 }));
  return { scale, panel, title, lines, rows, buttons, message };
}

export const initialMenuState = (model: MenuModel): MenuState => ({ focus: firstEnabled(model, 0, 1) });

const entries = (model: MenuModel): MenuItem[] => [...model.rows, ...model.buttons];
const isEnabled = (item: MenuItem | undefined): boolean => item !== undefined && item.enabled !== false;

function firstEnabled(model: MenuModel, from: number, dir: 1 | -1): number {
  const all = entries(model);
  for (let k = 0; k < all.length; k++) {
    const i = (((from + k * dir) % all.length) + all.length) % all.length;
    if (isEnabled(all[i])) return i;
  }
  return 0;
}

const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

export function stepMenu(layout: MenuLayout, model: MenuModel, state: MenuState, ev: MenuEvent): { state: MenuState; result: MenuResult } {
  const none: MenuResult = { kind: 'none' };
  const all = entries(model);
  if (ev.type === 'key') {
    switch (ev.key) {
      case 'ArrowUp': case 'ArrowLeft': return { state: { focus: firstEnabled(model, state.focus - 1, -1) }, result: none };
      case 'ArrowDown': case 'ArrowRight': return { state: { focus: firstEnabled(model, state.focus + 1, 1) }, result: none };
      case 'Enter': case ' ': {
        const item = all[state.focus];
        return { state, result: item && isEnabled(item) ? { kind: 'pick', id: item.id } : none };
      }
      default: return { state, result: none };
    }
  }
  const rects = [...layout.rows, ...layout.buttons];
  const i = rects.findIndex((r) => inside(r, ev.x, ev.y));
  const item = all[i];
  if (i < 0 || !isEnabled(item)) return { state, result: none };
  if (ev.type === 'hover') return { state: { focus: i }, result: none };
  return { state: { focus: i }, result: { kind: 'pick', id: item!.id } };
}

const COLORS = {
  background: 'rgba(24, 16, 8, 0.94)',
  border: '#c8a050',
  text: '#f0e0b8',
  dim: '#7a6848',
  button: '#382818',
  focus: '#6a4a20',
  row: '#2a1c0c',
  rowFocus: '#4a3418',
  message: '#e0a040',
};

function drawText(ctx: CanvasRenderingContext2D, font: Font, text: string, x: number, y: number, scale: number, css: string): void {
  if (text === '') return;
  ctx.fillStyle = css;
  let gx = x;
  for (let i = 0; i < text.length; i++) {
    const g = glyphFor(font, text.charCodeAt(i));
    for (let py = 0; py < g.height; py++) {
      for (let px = 0; px < g.width; px++) {
        if (g.pixels[py * g.width + px] !== 0) ctx.fillRect(gx + px * scale, y + py * scale, scale, scale);
      }
    }
    gx += g.width * scale;
  }
}

function textWidth(font: Font, text: string, scale: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += glyphFor(font, text.charCodeAt(i)).width * scale;
  return w;
}

export function drawMenuScreen(ctx: CanvasRenderingContext2D, font: Font, layout: MenuLayout, model: MenuModel, state: MenuState): void {
  const { scale, panel } = layout;
  const c = COLORS;
  ctx.fillStyle = c.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(panel.x + scale / 2, panel.y + scale / 2, panel.width - scale, panel.height - scale);
  drawText(ctx, font, model.title, layout.title.x, layout.title.y, scale, c.text);
  model.lines.forEach((line, i) => drawText(ctx, font, line, layout.lines[i]!.x, layout.lines[i]!.y, scale, c.text));
  model.rows.forEach((row, i) => {
    const r = layout.rows[i]!;
    const on = isEnabled(row);
    ctx.fillStyle = state.focus === i ? c.rowFocus : c.row;
    ctx.fillRect(r.x, r.y, r.width, r.height);
    const ty = r.y + Math.floor((r.height - font.height * scale) / 2);
    drawText(ctx, font, row.label, r.x + 2 * scale, ty, scale, on ? c.text : c.dim);
    if (row.detail) drawText(ctx, font, row.detail, r.x + r.width - textWidth(font, row.detail, scale) - 2 * scale, ty, scale, on ? c.text : c.dim);
  });
  if (model.message) drawText(ctx, font, model.message, layout.message.x, layout.message.y, scale, c.message);
  model.buttons.forEach((b, i) => {
    const r = layout.buttons[i]!;
    const on = isEnabled(b);
    ctx.fillStyle = state.focus === model.rows.length + i ? c.focus : c.button;
    ctx.fillRect(r.x, r.y, r.width, r.height);
    drawText(ctx, font, b.label, r.x + 2 * scale, r.y + Math.floor((r.height - font.height * scale) / 2), scale, on ? c.text : c.dim);
  });
}
