import { SKILL_NAMES, type Character } from '../formats/gam';
import { SpellCalc, type SpellDef } from '../formats/spells';
import { applyDamage } from '../combat/rules';
import { learnSpell, updateCharacter, type PartyState } from './party';

/**
 * Spell rules shared by the world and combat. Pure. The data comes from SPELLS.DAT; what a spell
 * *does* is derived from its targeting, calculation type and damage number, because the original's
 * effect code is not documented anywhere we have read (**unverified**, see docs/formats/spells.md).
 */

/** Spell numbers BaKGL names as timed "static" spells; the first three are lights. */
export const LIGHT_SPELLS: readonly number[] = [0, 2, 26];
/** Ticks of game time one point of power buys for a duration spell (one hour per point, as BaKGL). */
export const TICKS_PER_POWER = 0x708;

export type SpellKind =
  /** Hurts a chosen enemy (combat only). */
  | 'damage'
  /** Restores Health to a chosen ally. */
  | 'heal'
  /** Lights the way for a while (world only). */
  | 'light'
  /** Understood but not implemented yet. */
  | 'unsupported';

export function spellKind(s: SpellDef): SpellKind {
  if (LIGHT_SPELLS.includes(s.index)) return 'light';
  if (s.combat && s.damage > 0 && (s.targeting === 0 || s.targeting === 1 || s.targeting === 4)) return 'damage';
  if (s.damage !== 0 && (s.targeting === 2 || s.targeting === 3)) return 'heal';
  return 'unsupported';
}

export const isSpellcaster = (c: Character): boolean => c.skills.casting.max !== 0;

/** Stamina plus Health: what casting can spend. */
export const castingPool = (c: Pick<Character, 'skills'>): number =>
  c.skills.health.trueSkill + c.skills.stamina.trueSkill;

/** The spells a character knows that are in `defs`. */
export function knownSpells(c: Character, defs: readonly SpellDef[]): SpellDef[] {
  return c.spells.flatMap((i) => (defs[i] ? [defs[i]!] : []));
}

/** Whether `c` can cast now: a caster who knows it, can pay the minimum (Health + Stamina at least `minCost`, as BaKGL checks) and (for the world) the spell has a world effect. */
export function canCast(c: Character, s: SpellDef): boolean {
  return isSpellcaster(c) && c.spells.includes(s.index) && c.skills.health.trueSkill > 0 && castingPool(c) >= s.minCost;
}

/** Strongest power affordable: capped by `maxCost`, and the caster always keeps at least 1 point. */
export function maxPower(c: Character, s: SpellDef): number {
  return Math.max(s.minCost, Math.min(s.maxCost, castingPool(c) - 1));
}

/** Amount of damage or healing at `power`. */
export function spellAmount(s: SpellDef, power: number): number {
  const d = Math.abs(s.damage);
  switch (s.calc) {
    case SpellCalc.CostTimesDamage:
      return power * d;
    case SpellCalc.CostTimesDuration:
      return power * d;
    default:
      return d;
  }
}

/** Game time a light spell lasts at `power`. */
export const spellTicks = (power: number): number => Math.max(1, power) * TICKS_PER_POWER;

/** Pay `power` from Stamina first, then Health (never below 1 Health). */
export function payCost(c: Character, power: number): Character {
  const pool = applyDamage({ health: c.skills.health.trueSkill, stamina: c.skills.stamina.trueSkill }, power);
  const health = Math.max(1, pool.health);
  return {
    ...c,
    skills: {
      ...c.skills,
      health: { ...c.skills.health, trueSkill: health },
      stamina: { ...c.skills.stamina, trueSkill: pool.stamina },
    },
  };
}

export interface CastResult {
  party: PartyState;
  message: string;
  ok: boolean;
}

/** Cast a healing spell from `caster` on `target` (party indices) outside combat. */
export function castHeal(
  p: PartyState,
  casterIndex: number,
  spell: SpellDef,
  power: number,
  targetIndex: number,
): CastResult {
  const caster = p.characters.find((c) => c.index === casterIndex);
  const target = p.characters.find((c) => c.index === targetIndex);
  if (!caster || !target) return { party: p, message: 'Nobody there.', ok: false };
  if (spellKind(spell) !== 'heal') return { party: p, message: `${spell.name} does not heal.`, ok: false };
  if (!canCast(caster, spell)) return { party: p, message: `${caster.name} cannot cast ${spell.name} now.`, ok: false };
  const p2 = Math.min(power, maxPower(caster, spell));
  const amount = spellAmount(spell, p2);
  let next = updateCharacter(p, casterIndex, (c) => payCost(c, p2));
  next = updateCharacter(next, targetIndex, (c) => {
    const h = c.skills.health;
    return { ...c, skills: { ...c.skills, health: { ...h, trueSkill: Math.min(h.max, h.trueSkill + amount) } } };
  });
  return { party: next, ok: true, message: `${caster.name} casts ${spell.name}; ${target.name} regains health.` };
}

/** Learn the spell on a scroll. Magic-users only; fails when the spell is already known. */
export function learnFromScroll(
  p: PartyState,
  charIndex: number,
  spellIndex: number,
  defs: readonly SpellDef[],
): CastResult {
  const c = p.characters.find((x) => x.index === charIndex);
  if (!c) return { party: p, message: 'Nobody there.', ok: false };
  const name = defs[spellIndex]?.name ?? `spell ${spellIndex}`;
  if (!isSpellcaster(c)) return { party: p, message: `${c.name} cannot read magic.`, ok: false };
  if (c.spells.includes(spellIndex)) return { party: p, message: `${c.name} already knows ${name}.`, ok: false };
  return {
    party: updateCharacter(p, charIndex, (x) => learnSpell(x, spellIndex)),
    message: `${c.name} learns ${name}.`,
    ok: true,
  };
}

/** Skill whose bit is set in an item's effect mask (the lowest set bit), if any. */
export function skillOfMask(mask: number): (typeof SKILL_NAMES)[number] | undefined {
  for (let i = 0; i < SKILL_NAMES.length; i++) if ((mask >> i) & 1) return SKILL_NAMES[i];
  return undefined;
}

/** A timed light. */
export interface ActiveLight {
  spell: number;
  endTicks: number;
}

/** Light in force at `ticks`: the longest-lasting spell not yet expired. */
export function currentLight(lights: readonly ActiveLight[], ticks: number): ActiveLight | undefined {
  return lights.filter((l) => l.endTicks > ticks).sort((a, b) => b.endTicks - a.endTicks)[0];
}
