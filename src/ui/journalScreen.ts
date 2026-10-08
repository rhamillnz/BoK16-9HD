import { measureString, type Font } from '../formats/fnt';
import { journalEntries, type JournalEntry } from '../game/journal';
import { chooseScale, wrapParagraph, type Rect } from './dialogBox';
import { drawText } from './cutsceneScreen';
import { registerHudScreen, type HudEvent, type HudHost, type HudScreenHandler } from './hudRegistry';

export interface JournalLayout {
  scale: number;
  panel: Rect;
  title: Rect;
  rows: { slot: number; rect: Rect }[];
  detail: Rect;
}

export function layoutJournal(width: number, height: number, rowCount = 8): JournalLayout {
  const scale = chooseScale(height);
  const unit = scale * 10;
  const panelW = Math.min(width, 140 * unit);
  const rowH = unit * 1.5;
  const detailH = unit * 8;
  const panelH = Math.ceil(unit * 4 + rowCount * rowH + detailH + unit);
  const panel: Rect = { x: Math.floor((width - panelW) / 2), y: Math.floor((height - panelH) / 2), width: panelW, height: panelH };
  const pad = unit;
  const title: Rect = { x: panel.x + pad, y: panel.y + pad, width: panelW - 2 * pad, height: unit };
  const rowsTop = title.y + unit * 2;
  const rows = Array.from({ length: rowCount }, (_, slot) => ({
    slot,
    rect: { x: panel.x + pad, y: rowsTop + slot * rowH, width: panelW - 2 * pad, height: rowH - scale * 2 },
  }));
  const detail: Rect = { x: panel.x + pad, y: rowsTop + rowCount * rowH + unit / 2, width: panelW - 2 * pad, height: detailH };
  return { scale, panel, title, rows, detail };
}

export interface JournalState {
  selected: number;
  /** Index of the entry in the first visible row. */
  top: number;
}

export const initialJournalState = (): JournalState => ({ selected: 0, top: 0 });

/** Keep `selected` inside the window of `rows` rows. */
function follow(selected: number, top: number, rows: number): number {
  if (selected < top) return selected;
  if (selected >= top + rows) return selected - rows + 1;
  return top;
}

const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

export function stepJournal(layout: JournalLayout, state: JournalState, count: number, ev: HudEvent): JournalState {
  const rows = layout.rows.length;
  const move = (to: number): JournalState => {
    const selected = Math.max(0, Math.min(count - 1, to));
    return { selected, top: follow(selected, state.top, rows) };
  };
  if (count === 0) return state;
  if (ev.type === 'key') {
    switch (ev.key) {
      case 'ArrowUp': case 'w': case 'W': return move(state.selected - 1);
      case 'ArrowDown': case 's': case 'S': return move(state.selected + 1);
      case 'PageUp': return move(state.selected - rows);
      case 'PageDown': return move(state.selected + rows);
      case 'Home': return move(0);
      case 'End': return move(count - 1);
      default: return state;
    }
  }
  const row = layout.rows.find((r) => inside(r.rect, ev.x, ev.y));
  if (!row || state.top + row.slot >= count) return state;
  return ev.type === 'click' || ev.type === 'hover' ? { ...state, selected: state.top + row.slot } : state;
}

/** Cut `text` to fit `maxWidth` font pixels, ending in "..." when shortened. */
export function clipLine(font: Font, text: string, maxWidth: number): string {
  if (measureString(font, text) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && measureString(font, `${t}...`) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

const COLORS = { background: 'rgba(24, 16, 8, 0.94)', border: '#c8a050', text: '#f0e0b8', dim: '#a08860', row: '#2a1c0c', rowSelected: '#4a3418' };

export function drawJournal(ctx: CanvasRenderingContext2D, font: Font, layout: JournalLayout, state: JournalState, entries: readonly JournalEntry[]): void {
  const { scale, panel } = layout;
  const c = COLORS;
  ctx.fillStyle = c.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(panel.x + scale / 2, panel.y + scale / 2, panel.width - scale, panel.height - scale);
  drawText(ctx, font, 'Journal', layout.title.x, layout.title.y, scale, c.text);
  if (entries.length === 0) {
    drawText(ctx, font, 'Nothing noted yet. Things people tell you are kept here.', layout.rows[0]!.rect.x, layout.rows[0]!.rect.y, scale, c.dim);
    return;
  }
  for (const r of layout.rows) {
    const index = state.top + r.slot;
    const e = entries[index];
    if (!e) break;
    ctx.fillStyle = index === state.selected ? c.rowSelected : c.row;
    ctx.fillRect(r.rect.x, r.rect.y, r.rect.width, r.rect.height);
    const ty = r.rect.y + Math.floor((r.rect.height - font.height * scale) / 2);
    drawText(ctx, font, clipLine(font, e.text, Math.floor((r.rect.width - 4 * scale) / scale)), r.rect.x + 2 * scale, ty, scale, c.text);
  }
  const sel = entries[state.selected];
  if (!sel) return;
  const lines = wrapParagraph(font, sel.text, Math.floor(layout.detail.width / scale));
  const rowH = (font.height + 1) * scale;
  const maxRows = Math.max(1, Math.floor(layout.detail.height / rowH) - 1);
  lines.slice(0, maxRows).forEach((line, i) => drawText(ctx, font, line, layout.detail.x, layout.detail.y + i * rowH, scale, c.text));
  drawText(ctx, font, `Zone ${sel.zone}   ${state.selected + 1} of ${entries.length}`, layout.detail.x, layout.detail.y + layout.detail.height - rowH, scale, c.dim);
}

/** The journal as a registered HUD screen ('journal', hotkey J): dialogue lines seen so far, newest first. */
export class JournalScreen implements HudScreenHandler {
  hotkey = 'KeyJ';
  hotkeyInBase = true;
  private s: { layout: JournalLayout; state: JournalState } | undefined;
  constructor(private readonly host: HudHost) {}
  open(): boolean {
    this.s = { layout: layoutJournal(this.host.width, this.host.height), state: initialJournalState() };
    return true;
  }
  close(): void {
    this.s = undefined;
  }
  event(ev: HudEvent): void {
    const s = this.s;
    if (!s || ev.type === 'rightClick') return;
    s.state = stepJournal(s.layout, s.state, journalEntries().length, ev);
    this.host.invalidate();
  }
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.s) drawJournal(ctx, this.host.font, this.s.layout, this.s.state, journalEntries());
  }
}

registerHudScreen('journal', (h) => new JournalScreen(h));
