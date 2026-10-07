import { describe, expect, it } from 'vitest';
import {
  COMBAT_RECORD_SIZE,
  COMBAT_SAVE,
  GRID_LOCATION_SIZE,
  parseCombatTable,
  parsePartyGrid,
  readCombatEnemies,
  retreatSide,
} from '../src/combat/combatData';
import { parseMonsterNames, parseMonsterSprites } from '../src/combat/monsters';

/** Hand-built DEF_COMB.DAT with two combats; no original game data. */
function buildTable() {
  const b = new Uint8Array(4 + 2 * COMBAT_RECORD_SIZE);
  const v = new DataView(b.buffer);
  v.setUint32(0, 2, true);
  const rec = (n: number, index: number, enemies: [number, number, number, number, number][], ambush: number) => {
    let p = 4 + n * COMBAT_RECORD_SIZE + 3;
    v.setUint32(p, index, true);
    v.setUint32(p + 4, 0x1234, true);
    v.setUint32(p + 8, 0x5678, true);
    p += 16;
    for (const [x, y, h] of [
      [10, 20, 0x40],
      [30, 40, 0x80],
      [50, 60, 0xc0],
      [70, 80, 0x00],
    ]) {
      v.setUint32(p, x!, true);
      v.setUint32(p + 4, y!, true);
      v.setUint16(p + 8, h! << 8, true);
      p += 10;
    }
    b[p++] = enemies.length;
    enemies.forEach(([monster, move, x, y, h], k) => {
      const q = p + k * 48;
      v.setUint16(q, monster, true);
      v.setUint16(q + 2, move, true);
      v.setUint32(q + 4, x, true);
      v.setUint32(q + 8, y, true);
      v.setUint16(q + 12, h << 8, true);
    });
    p += 7 * 48;
    v.setUint16(p + 2, ambush, true);
  };
  rec(
    0,
    7,
    [
      [18, 0, 1000, 2000, 5],
      [23, 1, 3000, 4000, 9],
    ],
    1,
  );
  rec(1, 8, [], 0);
  return b;
}

describe('parseCombatTable', () => {
  const defs = parseCombatTable(buildTable());

  it('reads one record per entry with its dialogues and retreat points', () => {
    expect(defs).toHaveLength(2);
    expect(defs[0]).toMatchObject({ combatIndex: 7, entryDialog: 0x1234, scoutDialog: 0x5678, ambush: true });
    expect(defs[0]!.retreat.north).toEqual({ x: 10, y: 20, heading: 0x40 });
    expect(defs[0]!.retreat.east).toEqual({ x: 70, y: 80, heading: 0 });
  });

  it('reads only the declared combatants and keeps the next record aligned', () => {
    expect(defs[0]!.combatants).toEqual([
      { monster: 18, movementType: 0, position: { x: 1000, y: 2000, heading: 5 } },
      { monster: 23, movementType: 1, position: { x: 3000, y: 4000, heading: 9 } },
    ]);
    expect(defs[1]).toMatchObject({ combatIndex: 8, ambush: false, combatants: [] });
  });
});

describe('readCombatEnemies', () => {
  const save = new Uint8Array(COMBAT_SAVE.gridLocations + COMBAT_SAVE.gridLocationCount * GRID_LOCATION_SIZE);
  const v = new DataView(save.buffer);
  // Combat 3 holds combatants 5 and 6; the other five slots are empty.
  for (let i = 0; i < 7; i++) v.setUint16(COMBAT_SAVE.entityLists + 3 * 14 + i * 2, 0xffff, true);
  v.setUint16(COMBAT_SAVE.entityLists + 3 * 14, 5, true);
  v.setUint16(COMBAT_SAVE.entityLists + 3 * 14 + 2, 6, true);
  const loc = (c: number, monster: number, x: number, y: number, state: number) => {
    const p = COMBAT_SAVE.gridLocations + c * GRID_LOCATION_SIZE;
    v.setUint16(p + 2, monster, true);
    save[p + 4] = x;
    save[p + 5] = y;
    save[p + 8] = state;
    save[p + 14] = 30;
  };
  loc(5, 18, 3, 9, 1);
  loc(6, 23, 4, 10, 2);
  // Combatant 5 skills: health 20/18, speed 6, strength 9 with modifier -2.
  const st = COMBAT_SAVE.stats + 5 * 95 + 8;
  save.set([20, 18, 0, 0, 0], st);
  save.set([6, 6, 0, 0, 0], st + 2 * 5);
  save.set([9, 9, 0, 0, 0xfe], st + 3 * 5);

  it('decodes grid cell, monster, state and skills of each combatant', () => {
    const enemies = readCombatEnemies(save, 3);
    expect(enemies.map((e) => [e.combatant, e.monster, e.gridX, e.gridY, e.dead])).toEqual([
      [5, 18, 3, 9, false],
      [6, 23, 4, 10, true],
    ]);
    expect(enemies[0]!.retreatFactor).toBe(30);
    expect(enemies[0]!.skills.health).toEqual({ max: 20, trueSkill: 18, modifier: 0 });
    expect(enemies[0]!.skills.strength.modifier).toBe(-2);
  });

  it('returns nothing for an out-of-range combat index', () => {
    expect(readCombatEnemies(save, 700)).toEqual([]);
    expect(readCombatEnemies(save, -1)).toEqual([]);
  });
});

describe('parsePartyGrid', () => {
  it('reads six 22-byte records', () => {
    const b = new Uint8Array(6 * GRID_LOCATION_SIZE);
    const v = new DataView(b.buffer);
    for (let i = 0; i < 6; i++) {
      v.setUint16(i * 22 + 2, 100 + i, true);
      b[i * 22 + 4] = i;
      b[i * 22 + 5] = 2;
    }
    const slots = parsePartyGrid(b);
    expect(slots).toHaveLength(6);
    expect(slots[3]).toEqual({ monster: 103, gridX: 3, gridY: 2 });
  });
});

describe('retreatSide', () => {
  it('picks the side of the larger offset from the encounter centre', () => {
    const c = { x: 1000, y: 1000 };
    expect(retreatSide({ x: 1100, y: 3000 }, c)).toBe('north');
    expect(retreatSide({ x: 1100, y: -500 }, c)).toBe('south');
    expect(retreatSide({ x: 4000, y: 1100 }, c)).toBe('east');
    expect(retreatSide({ x: -2000, y: 900 }, c)).toBe('west');
  });
});

describe('monster tables', () => {
  const file = (records: number[][]) => {
    const body: number[] = [];
    const offs: number[] = [];
    for (const r of records) {
      offs.push(body.length);
      body.push(...r);
    }
    const head = new Uint8Array(4 + offs.length * 2);
    new DataView(head.buffer).setUint32(0, offs.length, true);
    offs.forEach((o, i) => new DataView(head.buffer).setUint16(4 + i * 2, o, true));
    return new Uint8Array([...head, ...body]);
  };
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);

  it('names are indexed by monster, with a placeholder at 0', () => {
    const names = parseMonsterNames(file([str('Brigand'), str('Moredhel')]));
    expect(names).toEqual(['INVALID MONSTER', 'Brigand', 'Moredhel']);
  });

  it('sprite sets carry the file prefix, suffixes and colour swap', () => {
    const sprites = parseMonsterSprites(file([[...str('BAND'), 0, 1, 2, 3]]));
    expect(sprites[0]!.prefix).toBe('');
    expect(sprites[1]).toEqual({ prefix: 'BAND', suffixes: [0, 1, 2], colorSwap: 3 });
  });
});
