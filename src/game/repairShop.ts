import { ITEM_STATUS_BITS, type InventoryItem } from '../formats/gam';
import type { ShopStats } from '../formats/gdsContainers';
import { ItemType, type ItemDef } from '../formats/objinfo';

/**
 * Menders (a town scene's Repair hotspot, or a shop dialogue that ends in repairs): swords, armour and crossbows,
 * as the shop's `repairTypes` bits allow, back to full condition for a price. Rules from BaKGL (bak/shop.cpp,
 * gui/repair.cpp; a format reference).
 */

/** Dialogue keys: the price offer (Yes is `ANSWER_ACCEPT`), can't repair that, nothing to repair. */
export const REPAIR_DIALOG = { cost: 0x1b7763, cantRepair: 0x1b7764, notNeeded: 0x1b7765 } as const;

/** Item index of Bessy Mauler, the dearer crossbow to repair. */
export const BESSY_MAULER = 32;

/** The shop mends this kind of item (bit 0 swords, bit 1 armour, bit 2 crossbows). */
export function canShopRepair(def: ItemDef, stats: ShopStats): boolean {
  if (def.type === ItemType.Crossbow) return (stats.repairTypes & 4) !== 0;
  if (def.type === ItemType.Sword) return (stats.repairTypes & 1) !== 0;
  if (def.type === ItemType.Armor) return (stats.repairTypes & 2) !== 0;
  return false;
}

/** A mender takes anything below full condition, and broken items. */
export const needsRepair = (item: InventoryItem): boolean => item.conditionOrQuantity !== 100 || item.broken;

/** Royals: crossbows a flat 400 (Bessy Mauler 800); otherwise value x repair factor x damage percent / 10000. */
export function repairCost(item: InventoryItem, def: ItemDef, stats: ShopStats): number {
  if (def.type === ItemType.Crossbow) return item.itemIndex === BESSY_MAULER ? 800 : 400;
  return Math.trunc((def.value * stats.repairFactor * (100 - item.conditionOrQuantity)) / 10000);
}

/** The item as good as new: full condition, no longer repairable or broken. */
export function repaired(item: InventoryItem): InventoryItem {
  const off = (1 << ITEM_STATUS_BITS.repairable) | (1 << ITEM_STATUS_BITS.broken);
  return { ...item, conditionOrQuantity: 100, repairable: false, broken: false, status: item.status & ~off };
}
