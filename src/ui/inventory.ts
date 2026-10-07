import type { Character, GamSave, InventoryItem } from '../formats/gam';
import { glyphFor, measureString, type Font } from '../formats/fnt';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { fitScale, resolveItemIcon, type ItemIconSet } from '../data/itemIcons';
import { HUD_HEIGHT, HUD_WIDTH, chooseScale, type Rect } from './dialogBox';

/** Slots per row in the item grid. */
export const SLOT_COLUMNS = 4;

export interface InventoryLayoutOptions {
  width: number;
  height: number;
  /** Integer pixel-font scale (>= 1). */
  scale: number;
  /** Number of character tabs (the active party size). */
  tabCount: number;
  /** Number of item slots to lay out. */
  slotCount: number;
}

export interface TabSlot {
  /** Position in the active party. */
  index: number;
  rect: Rect;
}

export interface ItemSlot {
  index: number;
  rect: Rect;
  /** Placeholder icon box inside the slot. */
  icon: Rect;
}

export interface InventoryLayout {
  panel: Rect;
  tabs: TabSlot[];
  slots: ItemSlot[];
  info: Rect;
  scale: number;
}

export function defaultLayoutOptions(tabCount: number, slotCount: number, width = HUD_WIDTH, height = HUD_HEIGHT): InventoryLayoutOptions {
  return { width, height, scale: chooseScale(height), tabCount, slotCount };
}

/** Pure layout: tab row on top, item grid on the left, info panel on the right. */
export function layoutInventory(opts: InventoryLayoutOptions): InventoryLayout {
  const { width, height, scale } = opts;
  const margin = Math.floor(height * 0.05);
  const panel: Rect = { x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 };
  const pad = 8 * scale;
  const tabHeight = 14 * scale;
  const tabCount = Math.max(1, opts.tabCount);
  const tabWidth = Math.min(64 * scale, Math.floor((panel.width - pad * 2) / tabCount));
  const tabs: TabSlot[] = [];
  for (let i = 0; i < opts.tabCount; i++) {
    tabs.push({ index: i, rect: { x: panel.x + pad + i * tabWidth, y: panel.y + pad, width: tabWidth, height: tabHeight } });
  }

  const bodyTop = panel.y + pad + tabHeight + pad;
  const bodyHeight = panel.y + panel.height - pad - bodyTop;
  const infoWidth = Math.floor(panel.width * 0.3);
  const gridWidth = panel.width - pad * 3 - infoWidth;
  const info: Rect = { x: panel.x + panel.width - pad - infoWidth, y: bodyTop, width: infoWidth, height: bodyHeight };

  const rows = Math.max(1, Math.ceil(opts.slotCount / SLOT_COLUMNS));
  const cellWidth = Math.floor(gridWidth / SLOT_COLUMNS);
  const cellHeight = Math.min(Math.floor(bodyHeight / rows), 40 * scale);
  const iconSize = cellHeight - 4 * scale;
  const slots: ItemSlot[] = [];
  for (let i = 0; i < opts.slotCount; i++) {
    const rect: Rect = {
      x: panel.x + pad + (i % SLOT_COLUMNS) * cellWidth,
      y: bodyTop + Math.floor(i / SLOT_COLUMNS) * cellHeight,
      width: cellWidth - 2 * scale,
      height: cellHeight - 2 * scale,
    };
    slots.push({ index: i, rect, icon: { x: rect.x + 2 * scale, y: rect.y + 2 * scale, width: iconSize, height: iconSize } });
  }
  return { panel, tabs, slots, info, scale };
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

export function slotAt(layout: InventoryLayout, x: number, y: number): number {
  return layout.slots.find((s) => inside(s.rect, x, y))?.index ?? -1;
}

export function tabAt(layout: InventoryLayout, x: number, y: number): number {
  return layout.tabs.find((t) => inside(t.rect, x, y))?.index ?? -1;
}

const CONDITION_TYPES: number[] = [ItemType.Sword, ItemType.Crossbow, ItemType.Staff, ItemType.Armor];

export interface ItemSummary {
  name: string;
  imageIndex: number;
  /** Display text for the quantity or condition, or '' when none applies. */
  amount: string;
  equipped: boolean;
  broken: boolean;
  poisoned: boolean;
}

/**
 * Describe an inventory item. OBJINFO flag bits (ConditionBased / QuantityBased) are not decoded
 * yet, so this infers: weapons and armour show condition %, stackable items show a quantity.
 */
export function summarizeItem(item: InventoryItem, defs: ItemDef[]): ItemSummary {
  const def = defs[item.itemIndex];
  if (!def) {
    return { name: `Item ${item.itemIndex}`, imageIndex: item.itemIndex, amount: '', equipped: item.equipped, broken: item.broken, poisoned: item.poisoned };
  }
  let amount = '';
  if (CONDITION_TYPES.includes(def.type)) amount = `${item.conditionOrQuantity}%`;
  else if (def.stackSize > 1) amount = `x${item.conditionOrQuantity}`;
  return { name: def.name, imageIndex: def.imageIndex, amount, equipped: item.equipped, broken: item.broken, poisoned: item.poisoned };
}

/** Info-panel lines for the selected item. OBJINFO has no weight field, so value and stats are shown. */
export function itemInfoLines(item: InventoryItem | undefined, defs: ItemDef[]): string[] {
  if (!item) return [];
  const def = defs[item.itemIndex];
  const s = summarizeItem(item, defs);
  const lines = [s.name];
  if (s.amount) lines.push(s.amount);
  if (def) {
    lines.push(`Value ${def.value}`);
    if (def.strengthSwing || def.strengthThrust) lines.push(`Damage ${def.strengthSwing}/${def.strengthThrust}`);
    if (def.accuracySwing || def.accuracyThrust) lines.push(`Accuracy ${def.accuracySwing}/${def.accuracyThrust}`);
  }
  if (s.equipped) lines.push('Equipped');
  if (s.broken) lines.push('Broken');
  if (s.poisoned) lines.push('Poisoned');
  return lines;
}

/** Key help shown at the bottom of the info panel. */
export const INVENTORY_HELP = ['Enter use  X equip', 'T give  R repair'];

/** Slots to lay out: the largest capacity in the party (the original's limit is slots, not weight). */
export function slotCountFor(party: Character[], fallback = 16): number {
  return party.reduce((n, c) => Math.max(n, c.inventory.capacity), 0) || fallback;
}

export function itemCountLine(c: Character | undefined): string {
  return c ? `Carrying ${c.inventory.items.length}/${c.inventory.capacity}` : '';
}

export interface InventoryState {
  /** Index into the active party. */
  tab: number;
  /** Selected slot, or -1. */
  selected: number;
}

export type InventoryEvent =
  | { type: 'key'; key: string }
  | { type: 'click'; x: number; y: number }
  | { type: 'hover'; x: number; y: number };

export function initialInventoryState(): InventoryState {
  return { tab: 0, selected: 0 };
}

/** Pure input reducer: arrows/WASD move the slot, Q/E or Tab change character, clicks pick slots or tabs. */
export function stepInventory(layout: InventoryLayout, state: InventoryState, ev: InventoryEvent): InventoryState {
  const n = layout.slots.length;
  const tabs = layout.tabs.length;
  if (ev.type === 'click' || ev.type === 'hover') {
    if (ev.type === 'click') {
      const t = tabAt(layout, ev.x, ev.y);
      if (t >= 0) return { tab: t, selected: 0 };
    }
    const s = slotAt(layout, ev.x, ev.y);
    return s >= 0 ? { ...state, selected: s } : state;
  }
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  const sel = state.selected < 0 ? 0 : state.selected;
  switch (key) {
    case 'ArrowLeft': case 'a': return { ...state, selected: Math.max(0, sel - 1) };
    case 'ArrowRight': case 'd': return { ...state, selected: Math.min(n - 1, sel + 1) };
    case 'ArrowUp': case 'w': return { ...state, selected: sel - SLOT_COLUMNS >= 0 ? sel - SLOT_COLUMNS : sel };
    case 'ArrowDown': case 's': return { ...state, selected: sel + SLOT_COLUMNS < n ? sel + SLOT_COLUMNS : sel };
    case 'q': return tabs > 0 ? { tab: (state.tab + tabs - 1) % tabs, selected: 0 } : state;
    case 'e': case 'Tab': return tabs > 0 ? { tab: (state.tab + 1) % tabs, selected: 0 } : state;
    default: return state;
  }
}

/** Characters of the active party, in party order. */
export function partyCharacters(save: GamSave): Character[] {
  return save.activeCharacters.map((i) => save.characters[i]).filter((c): c is Character => c !== undefined);
}

export interface InventoryColors {
  background: string;
  border: string;
  text: string;
  tab: string;
  tabActive: string;
  slot: string;
  slotSelected: string;
  icon: string;
  equipped: string;
}

export const INVENTORY_COLORS: InventoryColors = {
  background: 'rgba(24, 16, 8, 0.95)',
  border: '#c8a050',
  text: '#f0e0b8',
  tab: '#3a2a14',
  tabActive: '#6a4a20',
  slot: '#2a1c0c',
  slotSelected: '#8a6a30',
  icon: '#5a4a38',
  equipped: '#80d080',
};

/**
 * Shorten `text` with a trailing "..." so it fits `maxWidth` device pixels at `scale`. Text that
 * already fits is returned unchanged; when even "..." does not fit, the empty string is returned.
 */
export function fitText(font: Font, text: string, scale: number, maxWidth: number): string {
  const fits = (t: string) => measureString(font, t) * scale <= maxWidth;
  if (fits(text)) return text;
  const ellipsis = '...';
  for (let n = text.length - 1; n > 0; n--) {
    const t = text.slice(0, n).trimEnd() + ellipsis;
    if (fits(t)) return t;
  }
  return fits(ellipsis) ? ellipsis : '';
}

/** Draw glyph pixels with fillRect so unset pixels stay transparent (putImageData would overwrite the background). */
export function drawText(ctx: CanvasRenderingContext2D, font: Font, text: string, x: number, y: number, scale: number, css: string, maxWidth?: number) {
  if (text === '') return;
  const t = maxWidth === undefined ? text : fitText(font, text, scale, maxWidth);
  ctx.fillStyle = css;
  let gx = x;
  for (let i = 0; i < t.length; i++) {
    const g = glyphFor(font, t.charCodeAt(i));
    for (let py = 0; py < g.height; py++) {
      for (let px = 0; px < g.width; px++) {
        if (g.pixels[py * g.width + px] !== 0) ctx.fillRect(gx + px * scale, y + py * scale, scale, scale);
      }
    }
    gx += g.width * scale;
  }
}

/** Draw an item icon centred in `box`, scaled by an integer factor with nearest-neighbour sampling. */
export function drawIcon(ctx: CanvasRenderingContext2D, icons: ItemIconSet, imageIndex: number, box: Rect): boolean {
  const icon = resolveItemIcon(icons, imageIndex);
  if (!icon) return false;
  const k = fitScale(icon.width, icon.height, box.width, box.height);
  const canvas = document.createElement('canvas');
  canvas.width = icon.width;
  canvas.height = icon.height;
  canvas.getContext('2d')!.putImageData(new ImageData(icon.rgba, icon.width, icon.height), 0, 0);
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, box.x + Math.floor((box.width - icon.width * k) / 2), box.y + Math.floor((box.height - icon.height * k) / 2), icon.width * k, icon.height * k);
  ctx.imageSmoothingEnabled = prev;
  return true;
}

/** Draw one character's inventory screen. Without `icons` (or for unknown images) a placeholder box is drawn. */
export function drawInventory(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: InventoryLayout,
  state: InventoryState,
  party: Character[],
  defs: ItemDef[],
  colors: InventoryColors = INVENTORY_COLORS,
  icons?: ItemIconSet,
  message = '',
): void {
  const { scale, panel } = layout;
  ctx.fillStyle = colors.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(panel.x + scale / 2, panel.y + scale / 2, panel.width - scale, panel.height - scale);

  for (const tab of layout.tabs) {
    ctx.fillStyle = tab.index === state.tab ? colors.tabActive : colors.tab;
    ctx.fillRect(tab.rect.x, tab.rect.y, tab.rect.width, tab.rect.height);
    drawText(ctx, font, party[tab.index]?.name ?? '', tab.rect.x + 2 * scale, tab.rect.y + 2 * scale, scale, colors.text, tab.rect.width - 4 * scale);
  }

  const character = party[state.tab];
  const items = character?.inventory.items ?? [];
  for (const slot of layout.slots) {
    ctx.fillStyle = slot.index === state.selected ? colors.slotSelected : colors.slot;
    ctx.fillRect(slot.rect.x, slot.rect.y, slot.rect.width, slot.rect.height);
    const item = items[slot.index];
    if (!item) continue;
    const s = summarizeItem(item, defs);
    if (!icons || !drawIcon(ctx, icons, s.imageIndex, slot.icon)) {
      ctx.fillStyle = colors.icon;
      ctx.fillRect(slot.icon.x, slot.icon.y, slot.icon.width, slot.icon.height);
      drawText(ctx, font, String(s.imageIndex), slot.icon.x + scale, slot.icon.y + scale, scale, colors.text, slot.icon.width);
    }
    const tx = slot.icon.x + slot.icon.width + 2 * scale;
    const tw = slot.rect.x + slot.rect.width - tx - scale;
    const nameWidth = s.equipped ? tw - (font.maxWidth + 3) * scale : tw;
    drawText(ctx, font, s.name, tx, slot.rect.y + 2 * scale, scale, colors.text, nameWidth);
    drawText(ctx, font, s.amount, tx, slot.rect.y + 2 * scale + (font.height + 2) * scale, scale, colors.text, tw);
    if (s.equipped) drawText(ctx, font, 'E', slot.rect.x + slot.rect.width - (font.maxWidth + 2) * scale, slot.rect.y + 2 * scale, scale, colors.equipped);
  }

  ctx.fillStyle = colors.slot;
  ctx.fillRect(layout.info.x, layout.info.y, layout.info.width, layout.info.height);
  const lines = [itemCountLine(character), ...itemInfoLines(items[state.selected], defs)];
  lines.forEach((line, i) => {
    drawText(ctx, font, line, layout.info.x + 4 * scale, layout.info.y + 4 * scale + i * (font.height + 3) * scale, scale, colors.text, layout.info.width - 8 * scale);
  });
  const lineHeight = (font.height + 3) * scale;
  const bottom = layout.info.y + layout.info.height - 4 * scale;
  const footer = [...(message ? [message] : []), ...INVENTORY_HELP];
  footer.forEach((line, i) => {
    drawText(ctx, font, line, layout.info.x + 4 * scale, bottom - (footer.length - i) * lineHeight, scale, i === 0 && message ? colors.equipped : colors.text, layout.info.width - 8 * scale);
  });
}
