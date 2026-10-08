import { describe, expect, it } from 'vitest';
import { castableSpells, castSpell, startBattle, type Fighter } from '../src/combat/battle';
import { Direction } from '../src/combat/grid';
import { battleRewards } from '../src/combat/rewards';
import { RaceKind } from '../src/combat/rules';
import { SKILL_NAMES, type Character, type Skill } from '../src/formats/gam';
import { SpellCalc, type SpellDef } from '../src/formats/spells';
import { castHeal, canCast, currentLight, learnFromScroll, maxPower, spellAmount, spellKind } from '../src/game/spells';
import { powerChoices } from '../src/game/castControls';
import type { PartyState } from '../src/game/party';

const spell = (o: Partial<SpellDef>): SpellDef => ({
  index: 0,
  name: 'S',
  minCost: 2,
  maxCost: 6,
  combat: true,
  targeting: 0,
  calc: SpellCalc.CostTimesDamage,
  damage: 2,
  duration: 0,
  ...o,
});
const FIRE = spell({ index: 7, name: 'Fire' });
const MEND = spell({ index: 8, name: 'Mend', combat: false, targeting: 2, calc: SpellCalc.FixedAmount, damage: 9 });
const LAMP = spell({ index: 2, name: 'Candle', combat: false, targeting: 5, damage: 0 });

const sk = (max: number, trueSkill = max): Skill => ({
  max,
  trueSkill,
  current: trueSkill,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});
function mage(index: number, spells: number[], casting = 40): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, sk(0)])) as Character['skills'];
  skills.health = sk(30, 20);
  skills.stamina = sk(10, 4);
  skills.casting = sk(casting);
  return {
    index,
    name: `M${index}`,
    unknownHeader: new Uint8Array(2),
    spellBytes: new Uint8Array(6),
    spells,
    skills,
    combatCharIndex: 0,
    unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 0 },
    affectors: [],
    inventory: { capacity: 4, items: [] },
  };
}
const party = (cs: Character[]): PartyState => ({
  gold: 0,
  characters: cs,
  activeCharacters: cs.map((c) => c.index),
  partyKeys: { capacity: 8, items: [] },
});
const fighter = (id: string, side: 'party' | 'enemy', x: number, y: number, o: Partial<Fighter> = {}): Fighter => ({
  id,
  side,
  name: id,
  monster: 0,
  pos: { x, y },
  facing: Direction.North,
  health: 20,
  maxHealth: 20,
  stamina: 10,
  maxStamina: 10,
  speed: 5,
  strength: 8,
  defense: 0,
  melee: 90,
  race: RaceKind.None,
  ...o,
});

describe('spell rules', () => {
  it('classifies spells by targeting and damage', () => {
    expect([FIRE, MEND, LAMP, spell({ index: 9, combat: false, damage: 0 })].map(spellKind)).toEqual([
      'damage',
      'heal',
      'light',
      'unsupported',
    ]);
  });
  it('scales damage by power only for cost-times-damage', () => {
    expect(spellAmount(FIRE, 5)).toBe(10);
    expect(spellAmount(MEND, 5)).toBe(9);
  });
  it('limits power by what the caster can spend and keeps one point', () => {
    const m = mage(0, [7]);
    expect(maxPower(m, FIRE)).toBe(6);
    expect(maxPower({ ...m, skills: { ...m.skills, health: sk(30, 3), stamina: sk(10, 2) } }, FIRE)).toBe(4);
    expect(canCast(m, FIRE)).toBe(true);
    expect(canCast(mage(0, [], 0), FIRE)).toBe(false);
    expect(canCast(mage(0, []), FIRE)).toBe(false);
    expect(powerChoices(2, 6)).toEqual([2, 4, 6]);
    expect(powerChoices(3, 3)).toEqual([3]);
  });
  it('heals a party member and pays from stamina first', () => {
    const p = party([mage(0, [8]), mage(1, [])]);
    const r = castHeal(p, 0, MEND, 3, 1);
    expect(r.ok).toBe(true);
    const [a, b] = r.party.characters;
    expect(a!.skills.stamina.trueSkill).toBe(1);
    expect(a!.skills.health.trueSkill).toBe(20);
    expect(b!.skills.health.trueSkill).toBe(29);
    expect(castHeal(p, 1, MEND, 3, 0).ok).toBe(false);
  });
  it('learns from scrolls once, casters only', () => {
    const p = party([mage(0, []), mage(1, [], 0)]);
    expect(learnFromScroll(p, 1, 7, [FIRE]).ok).toBe(false);
    const r = learnFromScroll(p, 0, 7, [FIRE]);
    expect(r.party.characters[0]!.spells).toEqual([7]);
    expect(learnFromScroll(r.party, 0, 7, [FIRE]).ok).toBe(false);
  });
  it('tracks the longest light', () => {
    expect(
      currentLight(
        [
          { spell: 0, endTicks: 5 },
          { spell: 2, endTicks: 9 },
        ],
        6,
      ),
    ).toEqual({ spell: 2, endTicks: 9 });
    expect(currentLight([{ spell: 0, endTicks: 5 }], 6)).toBeUndefined();
  });
});

describe('casting in combat', () => {
  const start = () =>
    startBattle([
      fighter('a', 'party', 3, 1, { spells: [FIRE, MEND, LAMP], stamina: 4, health: 20, speed: 9 }),
      fighter('b', 'party', 4, 1, { health: 5 }),
      fighter('x', 'enemy', 3, 5, { speed: 1 }),
    ]);
  it('offers only combat damage and healing spells', () => {
    expect(castableSpells(start()).map((d) => d.name)).toEqual(['Fire', 'Mend']);
  });
  it('a damage spell hurts the enemy, ignores armour, costs power and ends the turn', () => {
    const s = start();
    const next = castSpell(s, 7, { x: 3, y: 5 })!;
    expect(next.events[0]).toMatchObject({ type: 'cast', kind: 'damage', power: 6, amount: 12 });
    const victim = next.fighters[2]!;
    expect(victim.stamina).toBe(0);
    expect(victim.health).toBe(18);
    expect(next.fighters[0]!.stamina).toBe(0);
    expect(next.fighters[0]!.health).toBe(18);
    expect(next.turn.current).not.toBe(0);
  });
  it('a healing spell restores an ally, capped at maximum, and refuses enemies', () => {
    const s = start();
    const healed = castSpell(s, 8, { x: 4, y: 1 })!;
    expect(healed.fighters[1]!.health).toBe(14);
    expect(castSpell(s, 8, { x: 3, y: 5 })).toBeUndefined();
    expect(castSpell(s, 7, { x: 4, y: 1 })).toBeUndefined();
    expect(castSpell(s, 99, { x: 3, y: 5 })).toBeUndefined();
  });
  it('a casting kill gives casting experience', () => {
    const s = startBattle([
      fighter('party0', 'party', 3, 1, { spells: [FIRE], speed: 9 }),
      fighter('enemy1', 'enemy', 3, 5, { speed: 1, health: 3, maxHealth: 20, stamina: 0 }),
    ]);
    const done = castSpell(s, 7, { x: 3, y: 5 })!;
    const rewards = battleRewards(done.fighters, done.history, () => 0);
    expect(rewards.experience.get('party0')).toMatchObject({ casting: 6 });
  });
});

describe('dialogue castSpell hook', () => {
  it('remembers a cast for a few game minutes', async () => {
    const { noteCast, justCast, JUST_CAST_TICKS } = await import('../src/game/castControls');
    noteCast(4, 1000);
    expect(justCast(4, 1000 + JUST_CAST_TICKS)).toBe(true);
    expect(justCast(4, 1001 + JUST_CAST_TICKS)).toBe(false);
    expect(justCast(5, 1000)).toBe(false);
  });
});
