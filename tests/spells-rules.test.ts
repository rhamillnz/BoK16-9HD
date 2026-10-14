import { describe, expect, it } from 'vitest';
import { castableSpells, castSpell, rest, startBattle, type Fighter } from '../src/combat/battle';
import { Direction } from '../src/combat/grid';
import { battleRewards } from '../src/combat/rewards';
import { RaceKind } from '../src/combat/rules';
import { SKILL_NAMES, type Character, type Skill } from '../src/formats/gam';
import { SpellCalc, type SpellDef } from '../src/formats/spells';
import {
  castHeal,
  canCast,
  currentLight,
  learnFromScroll,
  maxPower,
  spellActive,
  spellAmount,
  spellKind,
  spellTicks,
  staticSpellActive,
} from '../src/game/spells';
import { TICKS_PER_MINUTE } from '../src/game/state';
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
const MEND = spell({ index: 11, name: 'Mend', combat: true, targeting: 2, calc: SpellCalc.FixedAmount, damage: 9 });
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
    const p = party([mage(0, [11]), mage(1, [])]);
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
    const healed = castSpell(s, 11, { x: 4, y: 1 })!;
    expect(healed.fighters[1]!.health).toBe(14);
    expect(castSpell(s, 11, { x: 3, y: 5 })).toBeUndefined();
    expect(castSpell(s, 7, { x: 4, y: 1 })).toBeUndefined();
    expect(castSpell(s, 99, { x: 3, y: 5 })).toBeUndefined();
  });
  it("a hold spell takes the enemy's next turns", () => {
    const GRIEF = spell({
      index: 13,
      name: 'Grief',
      calc: SpellCalc.CostTimesDuration,
      damage: 0,
      duration: 2,
      minCost: 4,
      maxCost: 4,
    });
    const s = startBattle([
      fighter('a', 'party', 3, 1, { spells: [GRIEF], speed: 9 }),
      fighter('x', 'enemy', 3, 5, { speed: 1 }),
    ]);
    const held = castSpell(s, 13, { x: 3, y: 5 })!;
    expect(held.events[0]).toMatchObject({ type: 'cast', kind: 'hold', amount: 2 });
    // The enemy's turn was skipped: it is the caster's turn again, with one held turn left.
    expect(held.events.some((e) => e.type === 'held')).toBe(true);
    expect(held.turn.current).toBe(0);
    expect(held.fighters[1]!.held).toBe(1);
    const again = rest(held)!;
    expect(again.fighters[1]!.held).toBe(0);
    expect(again.turn.current).toBe(0);
    expect(rest(again)!.turn.current).toBe(1);
  });
  it('a ward soaks up damage before Health', () => {
    const HAVEN = spell({ index: 6, name: 'Haven', targeting: 3, damage: 0, minCost: 7, maxCost: 7 });
    const s = startBattle([
      fighter('a', 'party', 3, 1, { spells: [HAVEN, FIRE], speed: 9 }),
      fighter('b', 'party', 4, 1),
      fighter('x', 'enemy', 3, 5, { speed: 1 }),
    ]);
    const shielded = castSpell(s, 6, { x: 4, y: 1 })!;
    expect(shielded.fighters[1]!.ward).toBe(14);
    expect(castSpell(s, 6, { x: 3, y: 5 })).toBeUndefined();
  });
  it('area spells strike the other enemies in their reach', () => {
    const STORM = spell({ index: 28, name: 'Firestorm', damage: 4, minCost: 1, maxCost: 1 });
    const FLAME = spell({ index: 4, name: 'Flamecast', damage: 3, minCost: 1, maxCost: 1 });
    const fight = (d: SpellDef) =>
      startBattle([
        fighter('a', 'party', 3, 1, { spells: [d], speed: 9 }),
        fighter('x', 'enemy', 3, 5, { speed: 1 }),
        fighter('y', 'enemy', 4, 5, { speed: 1 }),
        fighter('z', 'enemy', 0, 2, { speed: 1 }),
      ]);
    const storm = castSpell(fight(STORM), 28, { x: 3, y: 5 })!;
    expect(storm.events[0]).toMatchObject({ type: 'cast', amount: 4, also: [{ target: 'y' }, { target: 'z' }] });
    expect(storm.fighters.slice(1).map((f) => f.stamina)).toEqual([6, 6, 6]);
    const flame = castSpell(fight(FLAME), 4, { x: 3, y: 5 })!;
    expect(flame.events[0]).toMatchObject({ also: [{ target: 'y' }] });
    expect(flame.fighters[3]!.stamina).toBe(10);
  });
  it('Strength Drain gives the caster the Health it takes', () => {
    const DRAIN = spell({ index: 42, name: 'Drain', calc: 5, damage: -1, minCost: 3, maxCost: 3 });
    const s = startBattle([
      fighter('a', 'party', 3, 1, { spells: [DRAIN], speed: 9, health: 10, stamina: 0 }),
      fighter('x', 'enemy', 3, 5, { speed: 1, stamina: 0 }),
    ]);
    const drained = castSpell(s, 42, { x: 3, y: 5 })!;
    expect(drained.events[0]).toMatchObject({ kind: 'drain', amount: 3 });
    expect(drained.fighters[1]!.health).toBe(17);
    // Paid 3 from Health, then got 3 back.
    expect(drained.fighters[0]!.health).toBe(10);
  });
  it('Wrath of Killian strikes for the middle of its 10-20', () => {
    expect(spellAmount(spell({ index: 19, calc: 4, damage: 1 }), 20)).toBe(15);
    expect(spellKind(spell({ index: 3, targeting: 1, calc: 3, damage: 20 }))).toBe('hold');
  });
  it('a cast gives casting experience', () => {
    const s = startBattle([
      fighter('party0', 'party', 3, 1, { spells: [FIRE], speed: 9 }),
      fighter('enemy1', 'enemy', 3, 5, { speed: 1, health: 3, maxHealth: 20, stamina: 0 }),
    ]);
    const done = castSpell(s, 7, { x: 3, y: 5 })!;
    const rewards = battleRewards(done.fighters, done.history, () => 0);
    expect(rewards.experience.get('party0')).toMatchObject({ casting: 2 });
  });
});

describe('timed spells', () => {
  const def = (index: number, duration: number) => ({ index, duration });
  it('last their duration in minutes, times the power for lights', () => {
    expect(spellTicks(def(2, 48), 3)).toBe(48 * 3 * TICKS_PER_MINUTE);
    expect(spellTicks(def(35, 120), 15)).toBe(120 * TICKS_PER_MINUTE);
  });
  it('answer the dialogue castSpell test by save slot', () => {
    const active = [
      { spell: 35, endTicks: 100 },
      { spell: 2, endTicks: 50 },
    ];
    expect(staticSpellActive(active, 3, 99)).toBe(true);
    expect(staticSpellActive(active, 3, 100)).toBe(false);
    expect(staticSpellActive(active, 5, 0)).toBe(false);
    expect(spellActive(active, 2, 10)).toBe(true);
  });
  it("are classified apart; Dannon's Delusions is not a heal", () => {
    expect(spellKind(spell({ index: 34, combat: false, targeting: 3, damage: 0 }))).toBe('timed');
    expect(spellKind(spell({ index: 1, combat: false, targeting: 3, damage: 1 }))).toBe('unsupported');
  });
  it('come back from a save, dropping anything malformed', async () => {
    const { parseTimedSpells } = await import('../src/game/castControls');
    expect(parseTimedSpells([{ spell: 34, endTicks: 900 }, { spell: 'x' }, null])).toEqual([
      { spell: 34, endTicks: 900 },
    ]);
    expect(parseTimedSpells(undefined)).toEqual([]);
  });
  it('only lights count as light', () => {
    expect(currentLight([{ spell: 35, endTicks: 100 }], 0)).toBeUndefined();
  });
});
