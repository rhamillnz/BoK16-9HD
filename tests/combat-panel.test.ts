import { describe, expect, it } from 'vitest';
import { attack, defend, startBattle, type Fighter } from '../src/combat/battle';
import { Direction } from '../src/combat/grid';
import { RaceKind } from '../src/combat/rules';
import { fighterRows, logLines, OUTCOME_TEXT } from '../src/ui/combatPanel';

const f = (id: string, name: string, side: 'party' | 'enemy', x: number, y: number, over: Partial<Fighter> = {}): Fighter => ({
  id, name, side, monster: 0, pos: { x, y }, facing: Direction.North, health: 20, maxHealth: 20, stamina: 10, maxStamina: 10,
  speed: 5, strength: 8, defense: 0, melee: 90, race: RaceKind.None, ...over,
});

describe('combat panel model', () => {
  const s = startBattle([f('a', 'Owyn', 'party', 3, 1), f('x', 'Brigand', 'enemy', 3, 2, { speed: 1 })]);

  it('lists every fighter and marks whose turn it is', () => {
    const rows = fighterRows(s);
    expect(rows.map((r) => [r.name, r.current, r.dead])).toEqual([['Owyn', true, false], ['Brigand', false, false]]);
    expect(rows[0]).toMatchObject({ health: '20/20', stamina: '10/10', fraction: 1 });
  });

  it('shows defending and the health fraction', () => {
    const after = defend(s)!;
    expect(fighterRows(after)[0]!.defending).toBe(true);
    const bare = startBattle([f('a', 'Owyn', 'party', 3, 1), f('x', 'Brigand', 'enemy', 3, 2, { speed: 1, stamina: 0 })]);
    expect(fighterRows(attack(bare, { x: 3, y: 2 }, (lo) => lo)!)[1]!.fraction).toBeLessThan(1);
  });

  it('describes events as plain sentences', () => {
    const hit = attack(s, { x: 3, y: 2 }, (lo) => lo)!;
    expect(logLines(hit)).toEqual([expect.stringMatching(/^Owyn strikes at Brigand for \d+\.$/)]);
    expect(OUTCOME_TEXT.won).toMatch(/Victory/);
  });
});
