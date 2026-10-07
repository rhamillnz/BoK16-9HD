import { glyphFor, measureString, type Font } from '../formats/fnt';
import type { SlotInfo } from '../game/saveGame';
import { HUD_HEIGHT, HUD_WIDTH, chooseScale, type Rect } from './dialogBox';

/**
 * Save/load slot screen: a Save and a Load tab over a list of slots (quick save first).
 * Up/Down choose a slot, Left/Right or S/L switch tab, Enter or a click uses the slot.
 * Pure layout and stepping so it can be tested without a canvas; `drawSaveScreen` paints it.
 */

export type SaveMode = 'save' | 'load';

export interface SaveScreenLayout {
  scale: number;
  panel: Rect;
  title: Rect;
  tabs: { mode: SaveMode; label: string; rect: Rect }[];
  rows: { index: number; rect: Rect }[];
  status: Rect;
}

export interface SaveScreenState {
  mode: SaveMode;
  selected: number;
  /** Feedback line ("Saved", "Slot is empty", ...). */
  message: string;
}

export type SaveScreenEvent =
  | { type: 'key'; key: string }
  | { type: 'click' | 'hover'; x: number; y: number };

export type SaveScreenResult = { kind: 'none' } | { kind: 'save'; slot: string } | { kind: 'load'; slot: string };

export function layoutSaveScreen(rowCount: number, width = HUD_WIDTH, height = HUD_HEIGHT): SaveScreenLayout {
  const scale = chooseScale(height);
  const unit = scale * 10;
  const panelW = Math.min(width, 140 * unit);
  const rowH = unit * 1.6;
  const panelH = Math.ceil(unit * 5.5 + rowCount * rowH + unit * 3);
  const panel: Rect = { x: Math.floor((width - panelW) / 2), y: Math.floor((height - panelH) / 2), width: panelW, height: panelH };
  const pad = unit;
  const title: Rect = { x: panel.x + pad, y: panel.y + pad, width: panelW - 2 * pad, height: unit };
  const tabW = 24 * unit;
  const tabY = title.y + unit * 2;
  const tabs = (['save', 'load'] as const).map((mode, i) => ({
    mode,
    label: mode === 'save' ? 'Save' : 'Load',
    rect: { x: panel.x + pad + i * (tabW + unit / 2), y: tabY, width: tabW, height: unit * 1.5 },
  }));
  const rowsTop = tabY + unit * 2.5;
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    index,
    rect: { x: panel.x + pad, y: rowsTop + index * rowH, width: panelW - 2 * pad, height: rowH - scale * 2 },
  }));
  const status: Rect = { x: panel.x + pad, y: panel.y + panelH - pad - unit, width: panelW - 2 * pad, height: unit };
  return { scale, panel, title, tabs, rows, status };
}

export const initialSaveScreenState = (mode: SaveMode = 'save'): SaveScreenState => ({ mode, selected: 0, message: '' });

const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

/** Slot a use of the screen would act on, or a message saying why not. */
function activate(state: SaveScreenState, slots: readonly SlotInfo[], index: number): { state: SaveScreenState; result: SaveScreenResult } {
  const info = slots[index];
  if (!info) return { state, result: { kind: 'none' } };
  if (state.mode === 'save') return { state: { ...state, selected: index, message: '' }, result: { kind: 'save', slot: info.slot } };
  if (info.corrupt) return { state: { ...state, selected: index, message: 'That save cannot be read' }, result: { kind: 'none' } };
  if (!info.summary) return { state: { ...state, selected: index, message: 'Slot is empty' }, result: { kind: 'none' } };
  return { state: { ...state, selected: index, message: '' }, result: { kind: 'load', slot: info.slot } };
}

export function stepSaveScreen(
  layout: SaveScreenLayout,
  state: SaveScreenState,
  slots: readonly SlotInfo[],
  ev: SaveScreenEvent,
): { state: SaveScreenState; result: SaveScreenResult } {
  const none: SaveScreenResult = { kind: 'none' };
  const count = layout.rows.length;
  if (ev.type === 'key') {
    switch (ev.key) {
      case 'ArrowUp': return { state: { ...state, selected: (state.selected + count - 1) % count, message: '' }, result: none };
      case 'ArrowDown': return { state: { ...state, selected: (state.selected + 1) % count, message: '' }, result: none };
      case 'ArrowLeft': case 'ArrowRight': return { state: { ...state, mode: state.mode === 'save' ? 'load' : 'save', message: '' }, result: none };
      case 's': case 'S': return { state: { ...state, mode: 'save', message: '' }, result: none };
      case 'l': case 'L': return { state: { ...state, mode: 'load', message: '' }, result: none };
      case 'Enter': case ' ': return activate(state, slots, state.selected);
      default: return { state, result: none };
    }
  }
  const tab = layout.tabs.find((t) => inside(t.rect, ev.x, ev.y));
  if (tab) return { state: ev.type === 'click' ? { ...state, mode: tab.mode, message: '' } : state, result: none };
  const row = layout.rows.find((r) => inside(r.rect, ev.x, ev.y));
  if (!row) return { state, result: none };
  if (ev.type === 'hover') return { state: { ...state, selected: row.index }, result: none };
  return activate(state, slots, row.index);
}

/** "Quick save" or "Slot 3" for a slot name. */
export function slotLabel(slot: string): string {
  const m = /^slot(\d+)$/.exec(slot);
  return m ? `Slot ${m[1]}` : 'Quick save (F5)';
}

/** "Zone 2  day 5 12:30  Owyn, Locklear  120 royals" for a filled slot. */
export function describeSlot(info: SlotInfo): string {
  if (info.corrupt) return '(unreadable)';
  const s = info.summary;
  if (!s) return '(empty)';
  const when = new Date(s.savedAt);
  const stamp = Number.isNaN(when.getTime()) ? '' : `  [${when.toISOString().slice(0, 16).replace('T', ' ')}]`;
  return `Zone ${s.zone}  ${s.gameTime}  ${s.members.join(', ')}  ${s.gold} royals${stamp}`;
}

const COLORS = {
  background: 'rgba(24, 16, 8, 0.94)',
  border: '#c8a050',
  text: '#f0e0b8',
  dim: '#a08860',
  tab: '#382818',
  tabSelected: '#6a4a20',
  row: '#2a1c0c',
  rowSelected: '#4a3418',
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

export function drawSaveScreen(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: SaveScreenLayout,
  state: SaveScreenState,
  slots: readonly SlotInfo[],
): void {
  const { scale, panel } = layout;
  const c = COLORS;
  ctx.fillStyle = c.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(panel.x + scale / 2, panel.y + scale / 2, panel.width - scale, panel.height - scale);

  drawText(ctx, font, 'Save and load', layout.title.x, layout.title.y, scale, c.text);
  for (const t of layout.tabs) {
    ctx.fillStyle = t.mode === state.mode ? c.tabSelected : c.tab;
    ctx.fillRect(t.rect.x, t.rect.y, t.rect.width, t.rect.height);
    drawText(ctx, font, t.label, t.rect.x + 2 * scale, t.rect.y + 2 * scale, scale, t.mode === state.mode ? c.text : c.dim);
  }
  for (const r of layout.rows) {
    const info = slots[r.index];
    if (!info) continue;
    ctx.fillStyle = r.index === state.selected ? c.rowSelected : c.row;
    ctx.fillRect(r.rect.x, r.rect.y, r.rect.width, r.rect.height);
    const ty = r.rect.y + Math.floor((r.rect.height - font.height * scale) / 2);
    drawText(ctx, font, slotLabel(info.slot), r.rect.x + 2 * scale, ty, scale, c.text);
    const detail = describeSlot(info);
    const dx = r.rect.x + 2 * scale + (measureString(font, 'Quick save (F5)') + 6) * scale;
    drawText(ctx, font, detail, dx, ty, scale, info.summary ? c.text : c.dim);
  }
  drawText(ctx, font, state.message || 'Arrows choose, Enter uses the slot, Esc closes', layout.status.x, layout.status.y, scale, state.message ? c.message : c.dim);
}
