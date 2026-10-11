import type { InventoryItem } from '../formats/gam';
import { glyphFor, measureString, type Font } from '../formats/fnt';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { fitScale, resolveItemIcon, type ItemIconSet } from '../data/itemIcons';
import type { Rect } from './dialogBox';

/** Shared drawing helpers and item summaries for the canvas screens (container, jump map). The player's own
 * inventory is the DOM view in inventoryView.ts. */
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
    return {
      name: `Item ${item.itemIndex}`,
      imageIndex: item.itemIndex,
      amount: '',
      equipped: item.equipped,
      broken: item.broken,
      poisoned: item.poisoned,
    };
  }
  let amount = '';
  if (CONDITION_TYPES.includes(def.type)) amount = `${item.conditionOrQuantity}%`;
  else if (def.stackSize > 1) amount = `x${item.conditionOrQuantity}`;
  return {
    name: def.name,
    imageIndex: def.imageIndex,
    amount,
    equipped: item.equipped,
    broken: item.broken,
    poisoned: item.poisoned,
  };
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
export function drawText(
  ctx: CanvasRenderingContext2D,
  font: Font,
  text: string,
  x: number,
  y: number,
  scale: number,
  css: string,
  maxWidth?: number,
) {
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
  ctx.drawImage(
    canvas,
    box.x + Math.floor((box.width - icon.width * k) / 2),
    box.y + Math.floor((box.height - icon.height * k) / 2),
    icon.width * k,
    icon.height * k,
  );
  ctx.imageSmoothingEnabled = prev;
  return true;
}
