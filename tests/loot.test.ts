import { describe, expect, it } from 'vitest';
import { lootOf } from '../src/combat/loot';
import type { Fighter } from '../src/combat/battle';

const fighter = (id: string, side: 'party' | 'enemy', health: number, slot?: number) =>
  ({ id, side, health, slot }) as Fighter;
const sword = { itemIndex: 3, conditionOrQuantity: 80, status: 0, modifiers: 0 };
const coins = { itemIndex: 54, conditionOrQuantity: 12, status: 0, modifiers: 0 };

describe('loot', () => {
  it('is what the slain enemies carried, by combat and enemy-list slot', () => {
    const inventories = new Map([
      ['7:0', [sword]],
      ['7:1', [coins]],
      ['8:0', [coins]],
    ]);
    const fighters = [
      fighter('party0', 'party', 0),
      fighter('enemy10', 'enemy', 0, 0),
      fighter('enemy11', 'enemy', 5, 1), // still alive (fled): keeps its things
    ];
    expect(lootOf(inventories, 7, fighters)).toEqual([sword]);
    expect(lootOf(inventories, 7, [...fighters, fighter('enemy12', 'enemy', -2, 1)])).toEqual([sword, coins]);
    expect(lootOf(inventories, 9, fighters)).toEqual([]);
  });
});
