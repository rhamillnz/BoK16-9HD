/**
 * What a fight leaves behind: experience, loot and wear on the party's gear. All worked out from
 * the battle's event history. BaKGL has no data for these (monster inventories are not parsed, and
 * skill improvement is the next backlog item), so the numbers are our own stand-ins (**unverified**).
 */

import { practiceSkill } from '../game/practice';
import type { Character, SkillName } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { updateCharacter, type PartyState } from '../game/party';
import type { BattleEvent, Fighter } from './battle';
import type { Roll } from './rules';

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
export const XP_PER_HIT_TAKEN = 1;
/** Experience for a kill is the victim's maximum Health divided by this, at least 1. */
export const KILL_XP_DIVISOR = 5;

export interface Rewards {
  /** Experience to add per party fighter id and skill. */
  experience: Map<string, Partial<Record<SkillName, number>>>;
  /** Royals found on the dead. */
  royals: number;
  /** Lines for the result screen. */
  lines: string[];
}

/**
 * Rewards for a won fight: skill experience for what each party member did, and a purse of royals
 * from each slain enemy (up to a quarter of its maximum Health).
 */
export function battleRewards(fighters: readonly Fighter[], history: readonly BattleEvent[], roll: Roll): Rewards {
  const tally = tallyBattle(history);
  const experience = new Map<string, Partial<Record<SkillName, number>>>();
  const lines: string[] = [];
  for (const f of fighters) {
    if (f.side !== 'party') continue;
    const t = tally.get(f.id);
    if (!t) continue;
    const bounty = t.slain.reduce(
      (sum, id) => sum + Math.max(1, Math.trunc((fighters.find((v) => v.id === id)?.maxHealth ?? 0) / KILL_XP_DIVISOR)),
      0,
    );
    const xp: Partial<Record<SkillName, number>> = {};
    // A kill's bounty goes to the skill the killer leaned on more.
    const caster = t.casts > 0 && t.meleeHits === 0 && t.rangedHits === 0;
    const shooter = t.rangedHits > t.meleeHits;
    if (t.meleeHits > 0 || (bounty > 0 && !shooter && !caster))
      xp.melee = t.meleeHits * XP_PER_HIT + (shooter || caster ? 0 : bounty);
    if (t.rangedHits > 0) xp.crossbow = t.rangedHits * XP_PER_HIT + (shooter ? bounty : 0);
    if (t.casts > 0) xp.casting = t.casts * XP_PER_HIT + (caster ? bounty : 0);
    if (t.hitsTaken > 0) xp.defense = t.hitsTaken * XP_PER_HIT_TAKEN;
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

/** An unarmed-on-the-defender's-side rule: armour loses 1 condition per this many hits taken. */
export const HITS_PER_ARMOR_WEAR = 2;

/**
 * Wear on equipment: each hit a character lands may dull the weapon they used (the item's dull
 * chance, losing 1 to its maximum dull amount), and every second hit they take wears their armour.
 */
export function applyWear(
  party: PartyState,
  history: readonly BattleEvent[],
  defs: readonly ItemDef[],
  roll: Roll,
): PartyState {
  const tally = tallyBattle(history);
  let next = party;
  for (const [id, t] of tally) {
    if (!id.startsWith('party')) continue;
    next = updateCharacter(next, indexOf(id), (c) => wearCharacter(c, t, defs, roll));
  }
  return next;
}

function wearCharacter(c: Character, t: FighterTally, defs: readonly ItemDef[], roll: Roll): Character {
  const dull = (it: Character['inventory']['items'][number], hits: number) => {
    const def = defs[it.itemIndex];
    let cond = it.conditionOrQuantity;
    for (let i = 0; i < hits && cond > 0; i++) {
      if (def && roll(0, 99) < def.dullChance) cond = Math.max(0, cond - roll(1, Math.max(1, def.maxDullAmount)));
    }
    return { ...it, conditionOrQuantity: cond, broken: it.broken || cond <= 0 };
  };
  const items = c.inventory.items.map((it) => {
    if (!it.equipped) return it;
    const type = defs[it.itemIndex]?.type;
    if (type === ItemType.Sword || type === ItemType.Staff) return dull(it, t.meleeHits);
    if (type === ItemType.Crossbow) return dull(it, t.rangedHits);
    if (type === ItemType.Armor) {
      const wear = Math.trunc(t.hitsTaken / HITS_PER_ARMOR_WEAR);
      return wear > 0 ? { ...it, conditionOrQuantity: Math.max(0, it.conditionOrQuantity - wear) } : it;
    }
    return it;
  });
  return { ...c, inventory: { ...c.inventory, items } };
}
