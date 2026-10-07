import { glyphFor, measureString, type Font } from '../formats/fnt';
import { HUD_HEIGHT, HUD_WIDTH, chooseScale, type Rect } from './dialogBox';

/**
 * Shop screen: the shop's stock on the left, the chosen party member's pack on the right.
 * Click a stock row to buy it (H or right click haggles over it), click a pack row to sell it.
 * Left/Right pick the party member, PageUp/PageDown turn the stock page, Escape leaves.
 * Pure layout and stepping so it can be tested without a canvas; `drawShopScreen` paints it.
 */

export const SHOP_ROWS_PER_PAGE = 12;

export interface ShopRow {
  label: string;
  /** Price text ("12 royals"); empty when the item is not for sale or not wanted. */
  price: string;
  /** Row is greyed (the shop will not take it, or the item was refused after a haggle). */
  dim: boolean;
}

export interface ShopModel {
  title: string;
  /** Money line, e.g. "Purse: 3 sovereigns 2 royals". */
  purse: string;
  members: string[];
  stock: ShopRow[];
  pack: ShopRow[];
}

export interface ShopLayout {
  scale: number;
  panel: Rect;
  title: Rect;
  members: { index: number; rect: Rect }[];
  stockRows: { slot: number; rect: Rect }[];
  packRows: { slot: number; rect: Rect }[];
  prev: Rect;
  next: Rect;
  status: Rect;
  leave: Rect;
}

export interface ShopScreenState {
  member: number;
  page: number;
  /** Highlighted row: `stock` index (absolute) or `pack` index. */
  hover: { side: 'stock' | 'pack'; index: number } | undefined;
  message: string;
}

export type ShopEvent =
  | { type: 'key'; key: string }
  | { type: 'click' | 'hover' | 'rightClick'; x: number; y: number };

export type ShopResult =
  | { kind: 'none' }
  | { kind: 'buy'; stock: number }
  | { kind: 'haggle'; stock: number }
  | { kind: 'sell'; pack: number }
  | { kind: 'member'; member: number }
  | { kind: 'leave' };

const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

export function layoutShopScreen(memberCount: number, width = HUD_WIDTH, height = HUD_HEIGHT): ShopLayout {
  const scale = chooseScale(height);
  const unit = scale * 10;
  const panelW = Math.min(width, 190 * unit);
  const rowH = unit * 1.6;
  const panelH = Math.ceil(unit * 8 + SHOP_ROWS_PER_PAGE * rowH);
  const panel: Rect = { x: Math.floor((width - panelW) / 2), y: Math.floor((height - panelH) / 2), width: panelW, height: panelH };
  const pad = unit;
  const title: Rect = { x: panel.x + pad, y: panel.y + pad, width: panelW - 2 * pad, height: unit };
  const memberW = Math.floor((panelW - 2 * pad - unit / 2 * (memberCount - 1)) / Math.max(1, memberCount));
  const tabY = title.y + unit * 2;
  const members = Array.from({ length: memberCount }, (_, index) => ({
    index, rect: { x: panel.x + pad + index * (memberW + unit / 2), y: tabY, width: memberW, height: unit * 1.5 },
  }));
  const colW = Math.floor((panelW - 3 * pad) / 2);
  const rowsTop = tabY + unit * 2.5;
  const column = (x: number) => Array.from({ length: SHOP_ROWS_PER_PAGE }, (_, slot) => ({
    slot, rect: { x, y: rowsTop + slot * rowH, width: colW, height: rowH - scale * 2 },
  }));
  const bottom = panel.y + panelH - pad - unit * 1.5;
  return {
    scale, panel, title, members,
    stockRows: column(panel.x + pad),
    packRows: column(panel.x + 2 * pad + colW),
    prev: { x: panel.x + pad, y: bottom, width: 8 * unit, height: unit * 1.5 },
    next: { x: panel.x + pad + 9 * unit, y: bottom, width: 8 * unit, height: unit * 1.5 },
    status: { x: panel.x + pad + 18 * unit, y: bottom, width: panelW - 2 * pad - 18 * unit - 14 * unit, height: unit * 1.5 },
    leave: { x: panel.x + panelW - pad - 12 * unit, y: bottom, width: 12 * unit, height: unit * 1.5 },
  };
}

export const initialShopState = (): ShopScreenState => ({ member: 0, page: 0, hover: undefined, message: '' });

export const shopPageCount = (stockCount: number): number => Math.max(1, Math.ceil(stockCount / SHOP_ROWS_PER_PAGE));

function hit(layout: ShopLayout, state: ShopScreenState, model: ShopModel, x: number, y: number): ShopScreenState['hover'] {
  const s = layout.stockRows.find((r) => inside(r.rect, x, y));
  if (s) {
    const index = state.page * SHOP_ROWS_PER_PAGE + s.slot;
    return index < model.stock.length ? { side: 'stock', index } : undefined;
  }
  const p = layout.packRows.find((r) => inside(r.rect, x, y));
  return p && p.slot < model.pack.length ? { side: 'pack', index: p.slot } : undefined;
}

export function stepShopScreen(
  layout: ShopLayout, state: ShopScreenState, model: ShopModel, ev: ShopEvent,
): { state: ShopScreenState; result: ShopResult } {
  const none: ShopResult = { kind: 'none' };
  const pages = shopPageCount(model.stock.length);
  const turn = (d: number) => ({ state: { ...state, page: (state.page + d + pages) % pages, hover: undefined, message: '' }, result: none });
  const pick = (m: number) => {
    const member = (m + model.members.length) % Math.max(1, model.members.length);
    return { state: { ...state, member, hover: undefined, message: '' }, result: { kind: 'member', member } as ShopResult };
  };
  if (ev.type === 'key') {
    switch (ev.key) {
      case 'ArrowLeft': return pick(state.member - 1);
      case 'ArrowRight': return pick(state.member + 1);
      case 'PageUp': return turn(-1);
      case 'PageDown': return turn(1);
      case 'h': case 'H':
        return state.hover?.side === 'stock' ? { state, result: { kind: 'haggle', stock: state.hover.index } } : { state, result: none };
      case 'Enter': case ' ':
        if (state.hover?.side === 'stock') return { state, result: { kind: 'buy', stock: state.hover.index } };
        return state.hover ? { state, result: { kind: 'sell', pack: state.hover.index } } : { state, result: none };
      default: return { state, result: none };
    }
  }
  const { x, y } = ev;
  if (ev.type === 'hover') return { state: { ...state, hover: hit(layout, state, model, x, y) }, result: none };
  const tab = layout.members.find((m) => inside(m.rect, x, y));
  if (tab && ev.type === 'click') return pick(tab.index);
  if (ev.type === 'click' && inside(layout.prev, x, y)) return turn(-1);
  if (ev.type === 'click' && inside(layout.next, x, y)) return turn(1);
  if (ev.type === 'click' && inside(layout.leave, x, y)) return { state, result: { kind: 'leave' } };
  const target = hit(layout, state, model, x, y);
  if (!target) return { state, result: none };
  const next = { ...state, hover: target };
  if (ev.type === 'rightClick') return target.side === 'stock' ? { state: next, result: { kind: 'haggle', stock: target.index } } : { state: next, result: none };
  return { state: next, result: target.side === 'stock' ? { kind: 'buy', stock: target.index } : { kind: 'sell', pack: target.index } };
}

const COLORS = {
  background: 'rgba(24, 16, 8, 0.95)',
  border: '#c8a050',
  text: '#f0e0b8',
  dim: '#7a6844',
  tab: '#382818',
  tabSelected: '#6a4a20',
  row: '#2a1c0c',
  rowHover: '#4a3418',
  price: '#e0c070',
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

export function drawShopScreen(
  ctx: CanvasRenderingContext2D, font: Font, layout: ShopLayout, state: ShopScreenState, model: ShopModel,
): void {
  const { scale, panel } = layout;
  const c = COLORS;
  ctx.fillStyle = c.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(panel.x + scale / 2, panel.y + scale / 2, panel.width - scale, panel.height - scale);

  drawText(ctx, font, model.title, layout.title.x, layout.title.y, scale, c.text);
  const purseX = layout.title.x + layout.title.width - measureString(font, model.purse) * scale;
  drawText(ctx, font, model.purse, purseX, layout.title.y, scale, c.price);

  const tab = (r: Rect, label: string, on: boolean) => {
    ctx.fillStyle = on ? c.tabSelected : c.tab;
    ctx.fillRect(r.x, r.y, r.width, r.height);
    drawText(ctx, font, label, r.x + 2 * scale, r.y + 2 * scale, scale, on ? c.text : c.dim);
  };
  for (const m of layout.members) tab(m.rect, model.members[m.index] ?? '', m.index === state.member);

  const row = (r: Rect, data: ShopRow, hover: boolean) => {
    ctx.fillStyle = hover ? c.rowHover : c.row;
    ctx.fillRect(r.x, r.y, r.width, r.height);
    const ty = r.y + Math.floor((r.height - font.height * scale) / 2);
    drawText(ctx, font, data.label, r.x + 2 * scale, ty, scale, data.dim ? c.dim : c.text);
    const px = r.x + r.width - 2 * scale - measureString(font, data.price) * scale;
    drawText(ctx, font, data.price, px, ty, scale, data.dim ? c.dim : c.price);
  };
  for (const r of layout.stockRows) {
    const index = state.page * SHOP_ROWS_PER_PAGE + r.slot;
    const data = model.stock[index];
    if (data) row(r.rect, data, state.hover?.side === 'stock' && state.hover.index === index);
  }
  for (const r of layout.packRows) {
    const data = model.pack[r.slot];
    if (data) row(r.rect, data, state.hover?.side === 'pack' && state.hover.index === r.slot);
  }

  const pages = shopPageCount(model.stock.length);
  tab(layout.prev, 'Prev', false);
  tab(layout.next, `Next ${state.page + 1}/${pages}`, false);
  tab(layout.leave, 'Leave', false);
  drawText(ctx, font, state.message || 'Click to buy or sell, H haggles, Esc leaves', layout.status.x, layout.status.y + 2 * scale, scale, state.message ? c.message : c.dim);
}
