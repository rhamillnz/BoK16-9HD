import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../src/formats/gam';
import { ItemType, type ItemDef } from '../src/formats/objinfo';
import {
  SLOT_COLUMNS,
  defaultLayoutOptions,
  initialInventoryState,
  itemInfoLines,
  layoutInventory,
  slotAt,
  stepInventory,
  summarizeItem,
  tabAt,
} from '../src/ui/inventory';

const def = (o: Partial<ItemDef>): ItemDef => ({ index: 0, name: 'Thing', imageIndex: 7, value: 12, stackSize: 1, type: ItemType.Other, strengthSwing: 0, strengthThrust: 0, accuracySwing: 0, accuracyThrust: 0, ...o }) as ItemDef;
const item = (o: Partial<InventoryItem>): InventoryItem => ({ itemIndex: 0, conditionOrQuantity: 50, status: 0, modifiers: 0, activated: false, used: false, broken: false, repairable: false, equipped: false, poisoned: false, ...o });

describe('layout', () => {
  const layout = layoutInventory(defaultLayoutOptions(3, 10));
  it('places tabs, slots and info inside the panel without overlap', () => {
    expect(layout.tabs).toHaveLength(3);
    expect(layout.slots).toHaveLength(10);
    for (const s of layout.slots) {
      expect(s.rect.x + s.rect.width).toBeLessThanOrEqual(layout.info.x);
      expect(s.rect.y + s.rect.height).toBeLessThanOrEqual(layout.panel.y + layout.panel.height);
      expect(s.icon.x + s.icon.width).toBeLessThanOrEqual(s.rect.x + s.rect.width);
    }
    expect(layout.slots[SLOT_COLUMNS]!.rect.y).toBeGreaterThan(layout.slots[0]!.rect.y);
  });
  it('hit-tests slots and tabs', () => {
    const s = layout.slots[5]!.rect;
    expect(slotAt(layout, s.x + 1, s.y + 1)).toBe(5);
    expect(slotAt(layout, 0, 0)).toBe(-1);
    const t = layout.tabs[2]!.rect;
    expect(tabAt(layout, t.x + 1, t.y + 1)).toBe(2);
    expect(tabAt(layout, 0, 0)).toBe(-1);
  });
});

describe('item summary', () => {
  it('shows condition for weapons and quantity for stacks', () => {
    expect(summarizeItem(item({}), [def({ type: ItemType.Sword })]).amount).toBe('50%');
    expect(summarizeItem(item({}), [def({ stackSize: 10 })]).amount).toBe('x50');
    expect(summarizeItem(item({}), [def({})]).amount).toBe('');
  });
  it('falls back for unknown items and carries markers', () => {
    expect(summarizeItem(item({ itemIndex: 9 }), []).name).toBe('Item 9');
    expect(itemInfoLines(item({ equipped: true, broken: true }), [def({})])).toEqual(['Thing', 'Value 12', 'Equipped', 'Broken']);
    expect(itemInfoLines(undefined, [])).toEqual([]);
  });
});

describe('input', () => {
  const layout = layoutInventory(defaultLayoutOptions(3, 10));
  it('moves the selection and clamps at edges', () => {
    let s = initialInventoryState();
    s = stepInventory(layout, s, { type: 'key', key: 'ArrowLeft' });
    expect(s.selected).toBe(0);
    s = stepInventory(layout, s, { type: 'key', key: 'ArrowDown' });
    expect(s.selected).toBe(SLOT_COLUMNS);
    s = stepInventory(layout, s, { type: 'key', key: 'ArrowDown' });
    s = stepInventory(layout, s, { type: 'key', key: 'ArrowDown' });
    expect(s.selected).toBe(SLOT_COLUMNS * 2);
  });
  it('cycles character tabs and resets selection', () => {
    let s = { tab: 0, selected: 3 };
    s = stepInventory(layout, s, { type: 'key', key: 'q' });
    expect(s).toEqual({ tab: 2, selected: 0 });
    s = stepInventory(layout, s, { type: 'key', key: 'Tab' });
    expect(s.tab).toBe(0);
  });
  it('selects by hover and switches tab by click', () => {
    const r = layout.slots[4]!.rect;
    expect(stepInventory(layout, initialInventoryState(), { type: 'hover', x: r.x + 1, y: r.y + 1 }).selected).toBe(4);
    const t = layout.tabs[1]!.rect;
    expect(stepInventory(layout, initialInventoryState(), { type: 'click', x: t.x + 1, y: t.y + 1 }).tab).toBe(1);
  });
});
