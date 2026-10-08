/**
 * What a fight leaves behind: skill practice, loot and wear on the party's gear, all worked out from
 * the battle's event history. Practice and wear follow BaKGL (docs/formats/combat-audit.md); the
 * loot and the ranged and casting experience are our own stand-ins (**unverified**).
 */

import { practiceSkill } from '../game/practice';
import type { Character, SkillName } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { updateCharacter, type PartyState } from '../game/party';
import type { BattleEvent, Fighter } from './battle';
import { DULL_FULL, DULL_HALF, dullCondition, type Roll } from './rules';

export interface FighterTally {
  meleeHits: number;
  rangedHits: number;
  /** Spells cast. */
  casts: number;
  hitsTaken: number;
  /** Ids of the fighters this one felled. */
  slain: string[];
}

const empty = (): FighterTally => ({ meleeHits: 0, rangedHits: 0, casts: 0, hitsTaken: 0, slain: [] });

/** Hits landed, hits taken and kills per fighter id. */
export function tallyBattle(history: readonly BattleEvent[]): Map<string, FighterTally> {
  const out = new Map<string, FighterTally>();
  const of = (id: string) => {
    let t = out.get(id);
    if (!t) out.set(id, (t = empty()));
    return t;
  };
  for (const e of history) {
    if (e.type === 'cast') {
      of(e.caster).casts++;
      if (e.kind === 'damage') {
        if (e.killed) of(e.caster).slain.push(e.target);
        of(e.target).hitsTaken++;
      }
      continue;
    }
    if (e.type !== 'attack' && e.type !== 'shoot') continue;
    if (!e.hit) continue;
    const a = of(e.attacker);
    if (e.type === 'shoot') a.rangedHits++;
    else a.meleeHits++;
    if (e.killed) a.slain.push(e.target);
    of(e.target).hitsTaken++;
  }
  return out;
}

export const XP_PER_HIT = 2;

export interface Rewards {
  /** Experience to add per party fighter id and skill. */
  experience: Map<string, Partial<Record<SkillName, number>>>;
  /** Royals found on the dead. */
  royals: number;
  /** Lines for the result screen. */
  lines: string[];
}

/**
 * Rewards for a won fight. Melee, Strength and Defense practice is not here: BaKGL grants it
 * attack by attack, win or lose (see `applyCombatPractice`) and has no experience for kills or for
 * hits taken. What is left are our own stand-ins (**unverified**): 2 Crossbow experience per shot
 * landed and 2 Casting experience per cast, and a purse of up to a quarter of each slain enemy's
 * maximum Health in royals.
 */
export function battleRewards(fighters: readonly Fighter[], history: readonly BattleEvent[], roll: Roll): Rewards {
  const tally = tallyBattle(history);
  const experience = new Map<string, Partial<Record<SkillName, number>>>();
  const lines: string[] = [];
  for (const f of fighters) {
    if (f.side !== 'party') continue;
    const t = tally.get(f.id);
    if (!t) continue;
    const xp: Partial<Record<SkillName, number>> = {};
    if (t.rangedHits > 0) xp.crossbow = t.rangedHits * XP_PER_HIT;
    if (t.casts > 0) xp.casting = t.casts * XP_PER_HIT;
    if (Object.keys(xp).length === 0) continue;
    experience.set(f.id, xp);
    lines.push(
      `${f.name} gains ${Object.entries(xp)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')} experience.`,
    );
  }
  let royals = 0;
  for (const f of fighters) if (f.side === 'enemy' && f.health <= 0) royals += roll(0, Math.trunc(f.maxHealth / 4));
  if (royals > 0) lines.push(`The party finds ${royals} royals.`);
  return { experience, royals, lines };
}

const indexOf = (f: string) => Number(f.replace('party', ''));

/** Adds the loot money and turns the experience into skill levels (see practice.ts). */
export function applyRewards(party: PartyState, rewards: Rewards): PartyState {
  let next: PartyState = { ...party, gold: party.gold + rewards.royals };
  for (const [id, xp] of rewards.experience) {
    next = updateCharacter(next, indexOf(id), (c) => {
      let out = c;
      for (const [name, n] of Object.entries(xp) as [SkillName, number][]) out = practiceSkill(out, name, 'direct', n);
      return out;
    });
  }
  return next;
}

/** Practice a melee attack earns, as `fraction` percentages of the current skill (BaKGL: 3 each). */
export const PRACTICE_FRACTION = 3;

/**
 * Skill practice from the melee exchanges in a battle's history, applied in order so each gain
 * uses the skill as it was at that moment. Every attack, hit or miss, practises the attacker's
 * Melee and the defender's Defense; a hit also practises the attacker's Melee and Strength again;
 * a miss practises the defender's Defense twice more. Only party members have skills to improve.
 * Granted whatever the outcome of the fight.
 */
export function applyCombatPractice(party: PartyState, history: readonly BattleEvent[]): PartyState {
  let next = party;
  const practise = (id: string, name: SkillName, times: number) => {
    if (!id.startsWith('party')) return;
    next = updateCharacter(next, indexOf(id), (c) => {
      let out = c;
      for (let i = 0; i < times; i++) out = practiceSkill(out, name, 'fraction', PRACTICE_FRACTION);
      return out;
    });
  };
  for (const e of history) {
    if (e.type !== 'attack') continue;
    practise(e.attacker, 'melee', 1);
    practise(e.target, 'defense', 1);
    if (e.hit) {
      practise(e.attacker, 'melee', 1);
      practise(e.attacker, 'strength', 1);
    } else {
      practise(e.target, 'defense', 2);
    }
  }
  return next;
}

/**
 * Wear on equipment, one use at a time in battle order (`dullCondition` has the rule). A melee hit
 * dulls the attacker's sword (not a staff) by half for a thrust and in full for a slash, and the
 * defender's armour in full; a shot that lands dulls the shooter's crossbow and the target's armour.
 * Misses wear nothing (BaKGL also dulls the attacker's sword on some misses, a branch its own author
 * doubts, so it is left out).
 */
export function applyWear(
  party: PartyState,
  history: readonly BattleEvent[],
  defs: readonly ItemDef[],
  roll: Roll,
): PartyState {
  let next = party;
  const wear = (id: string, type: number, factor: number) => {
    if (!id.startsWith('party')) return;
    next = updateCharacter(next, indexOf(id), (c) => dullEquipped(c, type, defs, factor, roll));
  };
  for (const e of history) {
    if ((e.type !== 'attack' && e.type !== 'shoot') || !e.hit) continue;
    if (e.type === 'attack') wear(e.attacker, ItemType.Sword, e.kind === 'thrust' ? DULL_HALF : DULL_FULL);
    else wear(e.attacker, ItemType.Crossbow, DULL_FULL);
    wear(e.target, ItemType.Armor, DULL_FULL);
  }
  return next;
}

function dullEquipped(c: Character, type: number, defs: readonly ItemDef[], factor: number, roll: Roll): Character {
  let changed = false;
  const items = c.inventory.items.map((it) => {
    const def = defs[it.itemIndex];
    if (changed || !it.equipped || it.broken || !def || def.type !== type) return it;
    changed = true;
    const condition = dullCondition(it.conditionOrQuantity, def, factor, roll, type === ItemType.Crossbow);
    return condition === it.conditionOrQuantity
      ? it
      : { ...it, conditionOrQuantity: condition, used: true, repairable: true, broken: condition <= 0 };
  });
  return { ...c, inventory: { ...c.inventory, items } };
}
