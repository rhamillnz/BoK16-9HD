import { describe, expect, it } from 'vitest';
import type { CombatOutcome } from '../combat/turns';
import { CHEST_AMBUSHES, installChestAmbushes } from './ambushes';
import { captureSaveExtras, restoreSaveExtras } from './saveExtras';

const table = { '1:5': { combat: 3, text: 'Ambush!', loot: { item: 80, quantity: 2, text: 'Picklocks!' } } };

function rig(outcomes: (CombatOutcome | undefined)[]) {
  const menus: string[] = [];
  const fights: number[] = [];
  const given: [number, number][] = [];
  const hook = installChestAmbushes(
    {
      menu: async (text) => (menus.push(text), 0),
      fight: async (n) => (fights.push(n), outcomes.shift()),
      give: (item, quantity) => (given.push([item, quantity]), true),
    },
    table,
  );
  return { hook, menus, fights, given };
}

describe('installChestAmbushes', () => {
  it('leaves other chests alone', async () => {
    const r = rig([]);
    expect(await r.hook('1:6')).toBe(true);
    expect(r.fights).toEqual([]);
  });

  it('fights once, hands over the loot and lets the party at the chest after a win', async () => {
    const r = rig(['won']);
    expect(await r.hook('1:5')).toBe(true);
    expect(r.fights).toEqual([3]);
    expect(r.given).toEqual([[80, 2]]);
    expect(r.menus).toEqual(['Ambush!', 'Picklocks!']);
    expect(await r.hook('1:5')).toBe(true);
    expect(r.fights).toHaveLength(1);
  });

  it('keeps the chest shut after a loss and attacks again next time', async () => {
    const r = rig(['fled', 'won']);
    expect(await r.hook('1:5')).toBe(false);
    expect(await r.hook('1:5')).toBe(true);
    expect(r.fights).toEqual([3, 3]);
  });

  it('remembers won ambushes in the save', async () => {
    const r = rig(['won']);
    await r.hook('1:5');
    const saved = captureSaveExtras();
    const again = rig([]);
    restoreSaveExtras(saved);
    expect(await again.hook('1:5')).toBe(true);
    expect(again.fights).toEqual([]);
  });

  it('starts the game with the moredhel at the first chest south of the start', () => {
    expect(CHEST_AMBUSHES['1:24']?.combat).toBe(1);
  });
});
