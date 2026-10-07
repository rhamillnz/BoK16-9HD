import type { ContainerItem } from '../formats/containers';
import { measureString, type Font } from '../formats/fnt';
import type { Character } from '../formats/gam';
import type { ItemDef } from '../formats/objinfo';
import type { ItemIconSet } from '../data/itemIcons';
import { toInventoryItem } from '../game/containers';
import { wordLockGuess, type WordLockState } from '../game/wordLock';
import { HUD_HEIGHT, HUD_WIDTH, chooseScale, wrapParagraph, type Rect } from './dialogBox';
import { INVENTORY_COLORS, drawIcon, drawText, itemInfoLines, summarizeItem, type ItemSummary } from './inventory';
import { registerHudScreen, type HudHost, type HudScreenHandler } from './hudRegistry';

/**
 * Container screen (chests, bags, gravestones) and the word-lock screen. Both are driven by a
 * view object the game supplies: the screen reads it on every draw, the game changes its own
 * state when the view's callbacks fire and calls `host.invalidate()`.
 */

const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

// ---- Container screen ------------------------------------------------------------

export interface ContainerView {
  title: string;
  /** Number of slots the container has. */
  capacity(): number;
  items(): readonly ContainerItem[];
  /** Status line: what the last action did. */
  message(): string;
  onTake(slot: number): void;
  onTakeAll(): void;
  /** Put item `slot` of the active party's `tab`-th character into the container. */
  onPut(tab: number, slot: number): void;
  onClose(): void;
}

export interface ContainerLayoutOptions {
  width: number;
  height: number;
  scale: number;
  tabCount: number;
  containerSlots: number;
  characterSlots: number;
}

export interface ContainerLayout {
  panel: Rect;
  title: Rect;
  containerSlots: { index: number; rect: Rect; icon: Rect }[];
  tabs: { index: number; rect: Rect }[];
  characterSlots: { index: number; rect: Rect; icon: Rect }[];
  info: Rect;
  takeAll: Rect;
  close: Rect;
  scale: number;
}

export const CONTAINER_COLUMNS = 2;

export function defaultContainerLayoutOptions(tabCount: number, containerSlots: number, characterSlots: number, width = HUD_WIDTH, height = HUD_HEIGHT): ContainerLayoutOptions {
  return { width, height, scale: chooseScale(height), tabCount, containerSlots, characterSlots };
}

function slotGrid(count: number, area: Rect, scale: number): { index: number; rect: Rect; icon: Rect }[] {
  const rows = Math.max(1, Math.ceil(count / CONTAINER_COLUMNS));
  const cellW = Math.floor(area.width / CONTAINER_COLUMNS);
  const cellH = Math.min(Math.floor(area.height / rows), 40 * scale);
  const iconSize = cellH - 4 * scale;
  return Array.from({ length: count }, (_, i) => {
    const rect: Rect = { x: area.x + (i % CONTAINER_COLUMNS) * cellW, y: area.y + Math.floor(i / CONTAINER_COLUMNS) * cellH, width: cellW - 2 * scale, height: cellH - 2 * scale };
    return { index: i, rect, icon: { x: rect.x + 2 * scale, y: rect.y + 2 * scale, width: iconSize, height: iconSize } };
  });
}

/** Pure layout: container on the left, the party's characters on the right, info and buttons below. */
export function layoutContainerScreen(o: ContainerLayoutOptions): ContainerLayout {
  const { width, height, scale } = o;
  const margin = Math.floor(height * 0.05);
  const panel: Rect = { x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 };
  const pad = 8 * scale;
  const rowH = 14 * scale;
  const title: Rect = { x: panel.x + pad, y: panel.y + pad, width: panel.width - pad * 2, height: rowH };
  const colW = Math.floor((panel.width - pad * 3) / 2);
  const left = panel.x + pad;
  const right = left + colW + pad;
  const bodyTop = title.y + rowH + pad;
  const footerH = 3 * rowH + pad;
  const bodyBottom = panel.y + panel.height - pad - footerH;

  const tabCount = Math.max(1, o.tabCount);
  const tabW = Math.min(64 * scale, Math.floor(colW / tabCount));
  const tabs = Array.from({ length: o.tabCount }, (_, i) => ({ index: i, rect: { x: right + i * tabW, y: bodyTop, width: tabW, height: rowH } }));

  const containerSlots = slotGrid(o.containerSlots, { x: left, y: bodyTop, width: colW, height: bodyBottom - bodyTop }, scale);
  const gridTop = bodyTop + rowH + pad;
  const characterSlots = slotGrid(o.characterSlots, { x: right, y: gridTop, width: colW, height: bodyBottom - gridTop }, scale);

  const footerTop = bodyBottom + pad;
  const info: Rect = { x: left, y: footerTop, width: colW, height: footerH };
  const btnW = 70 * scale;
  const close: Rect = { x: right + colW - btnW, y: footerTop + footerH - rowH - pad, width: btnW, height: rowH };
  const takeAll: Rect = { x: close.x - btnW - pad, y: close.y, width: btnW, height: rowH };
  return { panel, title, containerSlots, tabs, characterSlots, info, takeAll, close, scale };
}

export interface ContainerScreenState {
  tab: number;
  /** Highlighted slot, for the info panel. */
  hover: { side: 'container' | 'party'; slot: number } | undefined;
}

export type ContainerAction =
  | { kind: 'none' }
  | { kind: 'take'; slot: number }
  | { kind: 'takeAll' }
  | { kind: 'put'; tab: number; slot: number }
  | { kind: 'close' };

export type ContainerEvent = { type: 'key'; key: string } | { type: 'click' | 'hover'; x: number; y: number };

export const initialContainerState = (): ContainerScreenState => ({ tab: 0, hover: undefined });

/** Pure input reducer: click a container slot to take, a character slot to put, tabs to switch, T takes all, Q/E cycle characters. */
export function stepContainerScreen(layout: ContainerLayout, state: ContainerScreenState, ev: ContainerEvent): { state: ContainerScreenState; action: ContainerAction } {
  const none: ContainerAction = { kind: 'none' };
  if (ev.type === 'key') {
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const n = layout.tabs.length;
    if (key === 't') return { state, action: { kind: 'takeAll' } };
    if (key === 'q' && n > 0) return { state: { tab: (state.tab + n - 1) % n, hover: undefined }, action: none };
    if ((key === 'e' || key === 'Tab') && n > 0) return { state: { tab: (state.tab + 1) % n, hover: undefined }, action: none };
    return { state, action: none };
  }
  const { x, y } = ev;
  const cs = layout.containerSlots.find((s) => inside(s.rect, x, y));
  const ps = layout.characterSlots.find((s) => inside(s.rect, x, y));
  if (ev.type === 'hover') {
    const hover = cs ? { side: 'container' as const, slot: cs.index } : ps ? { side: 'party' as const, slot: ps.index } : undefined;
    return { state: { ...state, hover }, action: none };
  }
  const tab = layout.tabs.find((t) => inside(t.rect, x, y));
  if (tab) return { state: { tab: tab.index, hover: undefined }, action: none };
  if (inside(layout.takeAll, x, y)) return { state, action: { kind: 'takeAll' } };
  if (inside(layout.close, x, y)) return { state, action: { kind: 'close' } };
  if (cs) return { state, action: { kind: 'take', slot: cs.index } };
  if (ps) return { state, action: { kind: 'put', tab: state.tab, slot: ps.index } };
  return { state, action: none };
}

function drawButton(ctx: CanvasRenderingContext2D, font: Font, r: Rect, label: string, scale: number): void {
  ctx.fillStyle = INVENTORY_COLORS.tabActive;
  ctx.fillRect(r.x, r.y, r.width, r.height);
  const w = measureString(font, label) * scale;
  drawText(ctx, font, label, r.x + Math.floor((r.width - w) / 2), r.y + 2 * scale, scale, INVENTORY_COLORS.text);
}

function drawSlot(ctx: CanvasRenderingContext2D, font: Font, slot: { rect: Rect; icon: Rect }, item: ItemSummary | undefined, selected: boolean, scale: number, icons: ItemIconSet | undefined): void {
  const c = INVENTORY_COLORS;
  ctx.fillStyle = selected ? c.slotSelected : c.slot;
  ctx.fillRect(slot.rect.x, slot.rect.y, slot.rect.width, slot.rect.height);
  if (!item) return;
  if (!icons || !drawIcon(ctx, icons, item.imageIndex, slot.icon)) {
    ctx.fillStyle = c.icon;
    ctx.fillRect(slot.icon.x, slot.icon.y, slot.icon.width, slot.icon.height);
  }
  const tx = slot.icon.x + slot.icon.width + 2 * scale;
  const tw = slot.rect.x + slot.rect.width - tx - scale;
  drawText(ctx, font, item.name, tx, slot.rect.y + 2 * scale, scale, item.equipped ? c.equipped : c.text, tw);
  drawText(ctx, font, item.amount, tx, slot.rect.y + 2 * scale + (font.height + 2) * scale, scale, c.text, tw);
}

export function drawContainerScreen(
  ctx: CanvasRenderingContext2D, font: Font, layout: ContainerLayout, state: ContainerScreenState,
  view: ContainerView, party: Character[], defs: ItemDef[], icons?: ItemIconSet,
): void {
  const { scale, panel } = layout;
  const c = INVENTORY_COLORS;
  ctx.fillStyle = c.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(panel.x + scale / 2, panel.y + scale / 2, panel.width - scale, panel.height - scale);
  drawText(ctx, font, view.title, layout.title.x, layout.title.y + 2 * scale, scale, c.text, layout.title.width);

  const inv = (i: ContainerItem) => summarizeItem(toInventoryItem(i), defs);
  const items = view.items();
  for (const s of layout.containerSlots) {
    const it = items[s.index];
    drawSlot(ctx, font, s, it && inv(it), state.hover?.side === 'container' && state.hover.slot === s.index, scale, icons);
  }
  for (const t of layout.tabs) {
    ctx.fillStyle = t.index === state.tab ? c.tabActive : c.tab;
    ctx.fillRect(t.rect.x, t.rect.y, t.rect.width, t.rect.height);
    drawText(ctx, font, party[t.index]?.name ?? '', t.rect.x + 2 * scale, t.rect.y + 2 * scale, scale, c.text, t.rect.width - 4 * scale);
  }
  const mine = party[state.tab]?.inventory.items ?? [];
  for (const s of layout.characterSlots) {
    const it = mine[s.index];
    drawSlot(ctx, font, s, it && summarizeItem(it, defs), state.hover?.side === 'party' && state.hover.slot === s.index, scale, icons);
  }

  ctx.fillStyle = c.slot;
  ctx.fillRect(layout.info.x, layout.info.y, layout.info.width, layout.info.height);
  const hovered = state.hover?.side === 'container' ? items[state.hover.slot] && toInventoryItem(items[state.hover.slot]!) : state.hover ? mine[state.hover.slot] : undefined;
  const lines = itemInfoLines(hovered, defs);
  const msg = view.message();
  if (msg) lines.push(msg);
  lines.slice(0, 4).forEach((line, i) => drawText(ctx, font, line, layout.info.x + 4 * scale, layout.info.y + 3 * scale + i * (font.height + 3) * scale, scale, c.text, layout.info.width - 8 * scale));
  drawButton(ctx, font, layout.takeAll, 'Take all', scale);
  drawButton(ctx, font, layout.close, 'Close', scale);
}

export class ContainerScreen implements HudScreenHandler {
  private s: { layout: ContainerLayout; state: ContainerScreenState; view: ContainerView } | undefined;
  constructor(private readonly host: HudHost) {}

  /** Open on `view`; the party and the layout are taken from the HUD now. */
  show(view: ContainerView): void {
    const h = this.host;
    const slots = Math.max(0, ...h.party.map((c) => c.inventory.capacity));
    const layout = layoutContainerScreen(defaultContainerLayoutOptions(h.party.length, view.capacity(), slots, h.width, h.height));
    this.s = { layout, state: initialContainerState(), view };
  }
  open(): boolean {
    return this.s !== undefined;
  }
  close(): void {
    this.s = undefined;
  }
  event(ev: ContainerEvent): void {
    const s = this.s;
    if (!s) return;
    const r = stepContainerScreen(s.layout, s.state, ev);
    s.state = r.state;
    switch (r.action.kind) {
      case 'take': s.view.onTake(r.action.slot); break;
      case 'takeAll': s.view.onTakeAll(); break;
      case 'put': s.view.onPut(r.action.tab, r.action.slot); break;
      case 'close': this.escape(); break;
    }
  }
  escape(): void {
    const s = this.s;
    if (!s) return;
    this.s = undefined;
    this.host.close();
    s.view.onClose();
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const h = this.host;
    if (this.s) drawContainerScreen(ctx, h.font, this.s.layout, this.s.state, this.s.view, h.party, h.items, h.icons);
  }
}

// ---- Word-lock screen ------------------------------------------------------------

export interface WordLockView {
  state(): WordLockState;
  onTurn(tumbler: number): void;
  /** Gave up (Escape or the button). */
  onLeave(): void;
}

export interface WordLockLayout {
  panel: Rect;
  hint: Rect;
  tumblers: { index: number; rect: Rect }[];
  leave: Rect;
  scale: number;
}

export function layoutWordLock(tumblerCount: number, width = HUD_WIDTH, height = HUD_HEIGHT): WordLockLayout {
  const scale = chooseScale(height);
  const margin = Math.floor(height * 0.12);
  const panel: Rect = { x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 };
  const pad = 8 * scale;
  const hint: Rect = { x: panel.x + pad * 2, y: panel.y + pad * 2, width: panel.width - pad * 4, height: Math.floor(panel.height * 0.4) };
  const size = Math.min(28 * scale, Math.floor((panel.width - pad * 4) / Math.max(1, tumblerCount)) - 2 * scale);
  const total = tumblerCount * (size + 2 * scale);
  const x0 = panel.x + Math.floor((panel.width - total) / 2);
  const y0 = hint.y + hint.height + pad * 2;
  const tumblers = Array.from({ length: tumblerCount }, (_, i) => ({ index: i, rect: { x: x0 + i * (size + 2 * scale), y: y0, width: size, height: size + 8 * scale } }));
  const leave: Rect = { x: panel.x + Math.floor((panel.width - 70 * scale) / 2), y: panel.y + panel.height - pad - 14 * scale, width: 70 * scale, height: 14 * scale };
  return { panel, hint, tumblers, leave, scale };
}

export type WordLockAction = { kind: 'none' } | { kind: 'turn'; tumbler: number } | { kind: 'leave' };

export function stepWordLock(layout: WordLockLayout, ev: { type: 'key'; key: string } | { type: 'click' | 'hover'; x: number; y: number }, tumblerCount: number): WordLockAction {
  if (ev.type === 'key') {
    const n = Number(ev.key);
    return ev.key.length === 1 && n >= 1 && n <= tumblerCount ? { kind: 'turn', tumbler: n - 1 } : { kind: 'none' };
  }
  if (ev.type === 'hover') return { kind: 'none' };
  const t = layout.tumblers.find((u) => inside(u.rect, ev.x, ev.y));
  if (t) return { kind: 'turn', tumbler: t.index };
  return inside(layout.leave, ev.x, ev.y) ? { kind: 'leave' } : { kind: 'none' };
}

export function drawWordLock(ctx: CanvasRenderingContext2D, font: Font, layout: WordLockLayout, state: WordLockState): void {
  const { scale, panel } = layout;
  const c = INVENTORY_COLORS;
  ctx.fillStyle = c.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(panel.x + scale / 2, panel.y + scale / 2, panel.width - scale, panel.height - scale);
  const lines = wrapParagraph(font, state.puzzle.hint, Math.floor(layout.hint.width / scale));
  lines.forEach((line, i) => drawText(ctx, font, line, layout.hint.x, layout.hint.y + i * (font.height + 3) * scale, scale, c.text));
  const guess = wordLockGuess(state);
  for (const t of layout.tumblers) {
    ctx.fillStyle = c.slotSelected;
    ctx.fillRect(t.rect.x, t.rect.y, t.rect.width, t.rect.height);
    const ch = guess[t.index] ?? '';
    const w = measureString(font, ch) * scale;
    drawText(ctx, font, ch, t.rect.x + Math.floor((t.rect.width - w) / 2), t.rect.y + 4 * scale, scale, c.text);
  }
  drawButton(ctx, font, layout.leave, 'Give up', scale);
}

export class WordLockScreen implements HudScreenHandler {
  private s: { layout: WordLockLayout; view: WordLockView } | undefined;
  constructor(private readonly host: HudHost) {}
  show(view: WordLockView): void {
    this.s = { layout: layoutWordLock(view.state().position.length, this.host.width, this.host.height), view };
  }
  open(): boolean {
    return this.s !== undefined;
  }
  close(): void {
    this.s = undefined;
  }
  event(ev: Parameters<typeof stepWordLock>[1]): void {
    const s = this.s;
    if (!s) return;
    const a = stepWordLock(s.layout, ev, s.layout.tumblers.length);
    if (a.kind === 'turn') s.view.onTurn(a.tumbler);
    else if (a.kind === 'leave') this.escape();
  }
  escape(): void {
    const s = this.s;
    if (!s) return;
    this.s = undefined;
    this.host.close();
    s.view.onLeave();
  }
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.s) drawWordLock(ctx, this.host.font, this.s.layout, this.s.view.state());
  }
}

registerHudScreen('container', (h) => new ContainerScreen(h));
registerHudScreen('wordlock', (h) => new WordLockScreen(h));
