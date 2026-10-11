import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../src/formats/gam';
import type { Font, Glyph } from '../src/formats/fnt';
import { ItemType, type ItemDef } from '../src/formats/objinfo';
import { fitText, itemInfoLines, summarizeItem } from '../src/ui/inventory';

const def = (o: Partial<ItemDef>): ItemDef =>
  ({
    index: 0,
    name: 'Thing',
    imageIndex: 7,
    value: 12,
    stackSize: 1,
    type: ItemType.Other,
    strengthSwing: 0,
    strengthThrust: 0,
    accuracySwing: 0,
    accuracyThrust: 0,
    ...o,
  }) as ItemDef;
const item = (o: Partial<InventoryItem>): InventoryItem => ({
  itemIndex: 0,
  conditionOrQuantity: 50,
  status: 0,
  modifiers: 0,
  activated: false,
  used: false,
  broken: false,
  repairable: false,
  equipped: false,
  poisoned: false,
  ...o,
});

describe('item summary', () => {
  it('shows condition for weapons and quantity for stacks', () => {
    expect(summarizeItem(item({}), [def({ type: ItemType.Sword })]).amount).toBe('50%');
    expect(summarizeItem(item({}), [def({ stackSize: 10 })]).amount).toBe('x50');
    expect(summarizeItem(item({}), [def({})]).amount).toBe('');
  });
  it('falls back for unknown items and carries markers', () => {
    expect(summarizeItem(item({ itemIndex: 9 }), []).name).toBe('Item 9');
    expect(itemInfoLines(item({ equipped: true, broken: true }), [def({})])).toEqual([
      'Thing',
      'Value 12',
      'Equipped',
      'Broken',
    ]);
    expect(itemInfoLines(undefined, [])).toEqual([]);
  });
});

describe('fitText', () => {
  const glyphs: Glyph[] = [];
  for (let code = 32; code < 127; code++)
    glyphs.push({ code, width: 4, height: 6, pixels: new Uint8Array(24).fill(1) });
  const font: Font = { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };
  it('leaves text that fits unchanged', () => {
    expect(fitText(font, 'Sword', 2, 40)).toBe('Sword');
  });
  it('ellipsizes long names to the width', () => {
    const out = fitText(font, 'Standard Knife', 2, 12 * 4 * 2);
    expect(out.endsWith('...')).toBe(true);
    expect(out.length).toBeLessThan('Standard Knife'.length);
    expect(out.length * 4 * 2).toBeLessThanOrEqual(12 * 4 * 2);
  });
  it('returns an empty string when not even the ellipsis fits', () => {
    expect(fitText(font, 'Standard Knife', 2, 8)).toBe('');
  });
});
