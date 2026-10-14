import { SKILL_NAMES, type Character } from '../formats/gam';
import { SpellCalc, type SpellDef } from '../formats/spells';
import { applyDamage } from '../combat/rules';
import { learnSpell, updateCharacter, type PartyState } from './party';
import { TICKS_PER_MINUTE } from './state';

/**
 * Spell rules shared by the world and combat. Pure. The data comes from SPELLS.DAT; what a spell
 * *does* is derived from its targeting, calculation type and damage number, because the original's
 * effect code is not documented anywhere we have read (**unverified**, see docs/formats/spells.md).
 */

/**
 * The timed ("static") spells by their slot in the save's active-spell bits (BaKGL's order): Dragon's Breath,
 * Candle Glow, Stardusk, And the Light Shall Lie, Union, Scent of Sarig. Dialogue `castSpell` choices test a slot.
 */
export const STATIC_SPELLS: readonly number[] = [0, 2, 26, 35, 34, 8];
/** Despair Thy Eyes (blinds) and Grief of 1000 Nights (holds): SPELLDOC effects, not damage. */
export const HOLD_SPELLS: readonly number[] = [3, 13];
/** Hocho's Haven (shields from damage) and Skin of the Dragon (invisible armour). */
export const WARD_SPELLS: readonly number[] = [6, 23];
/** Strength Drain: "Drains strength from victim and gives to caster". */
export const DRAIN_SPELLS: readonly number[] = [42];

/**
 * Who else a damage spell strikes besides its target (SPELLDOC): Firestorm "all targets within LOS" (every enemy
 * in range), Evil Seek "more than one target" (the two enemies nearest the target), Flamecast "area fire damage"
 * (enemies next to the target). The reach of each is our reading (**unverified**).
 */
export const SPELL_SPLASH: Record<number, 'all' | 'nearest2' | 'adjacent'> = {
  28: 'all',
  44: 'nearest2',
  4: 'adjacent',
};

/** SPELLDOC damage of the special-calculation spells, as a fixed middle: Wrath of Killian "10-20". */
const SPECIAL_DAMAGE: Record<number, number> = { 19: 15 };

/** The timed spells that light the way (Dragon's Breath also hides the party in fog). */
export const LIGHT_SPELLS: readonly number[] = [0, 2, 26];

export type SpellKind =
  /** Hurts a chosen enemy (combat only). */
  | 'damage'
  /** Restores Health to a chosen ally. */
  | 'heal'
  /** Takes a chosen enemy's next turns (blinded or held; combat only). */
  | 'hold'
  /** Puts a shield of points on a chosen ally that soaks up damage (combat only). */
  | 'ward'
  /** Hurts a chosen enemy and gives the caster the Health it took (combat only). */
  | 'drain'
  /** Lights the way for a while (world only). */
  | 'light'
  /** Another timed world spell (disguise, reading moredhel, sensing traps). */
  | 'timed'
  /** Understood but not implemented yet. */
  | 'unsupported';

export function spellKind(s: SpellDef): SpellKind {
  if (LIGHT_SPELLS.includes(s.index)) return 'light';
  if (STATIC_SPELLS.includes(s.index)) return 'timed';
  if (HOLD_SPELLS.includes(s.index)) return 'hold';
  if (WARD_SPELLS.includes(s.index)) return 'ward';
  if (DRAIN_SPELLS.includes(s.index)) return 'drain';
  if (s.combat && s.damage > 0 && (s.targeting === 0 || s.targeting === 1 || s.targeting === 4)) return 'damage';
  // Dannon's Delusions (not a combat spell, damage 1) makes an illusionary fighter, it does not heal.
  if (s.combat && s.damage !== 0 && (s.targeting === 2 || s.targeting === 3)) return 'heal';
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

/**
 * Amount of damage or healing at `power`; for a hold the target's turns lost, for a ward its shield points
 * (our stand-ins, **unverified**: a quarter of power x duration turns, at least one; two points per power).
 */
export function spellAmount(s: SpellDef, power: number): number {
  if (HOLD_SPELLS.includes(s.index)) return Math.max(1, Math.ceil((power * Math.max(1, s.duration)) / 4));
  if (WARD_SPELLS.includes(s.index)) return power * 2;
  if (DRAIN_SPELLS.includes(s.index)) return power;
  const special = SPECIAL_DAMAGE[s.index];
  if (special !== undefined) return special;
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

/**
 * Game time a timed spell lasts: its SPELLS.DAT duration in minutes, times the power for the lights (SPELLDOC:
 * "Duration: 10 minutes X Cost" for Dragon's Breath, 48 for Candle Glow and Stardusk); the others last a fixed time.
 */
export function spellTicks(s: Pick<SpellDef, 'index' | 'duration'>, power: number): number {
  const minutes = Math.max(1, s.duration) * (LIGHT_SPELLS.includes(s.index) ? Math.max(1, power) : 1);
  return minutes * TICKS_PER_MINUTE;
}

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

/** A timed spell in force until `endTicks`. */
export interface ActiveLight {
  spell: number;
  endTicks: number;
}

/** Light in force at `ticks`: the longest-lasting light spell not yet expired. */
export function currentLight(lights: readonly ActiveLight[], ticks: number): ActiveLight | undefined {
  return lights
    .filter((l) => LIGHT_SPELLS.includes(l.spell) && l.endTicks > ticks)
    .sort((a, b) => b.endTicks - a.endTicks)[0];
}

/** Whether timed spell `spell` (a SPELLS.DAT index) is in force at `ticks`. */
export const spellActive = (active: readonly ActiveLight[], spell: number, ticks: number): boolean =>
  active.some((l) => l.spell === spell && l.endTicks > ticks);

/** Whether the timed spell in save slot `slot` (STATIC_SPELLS order) is in force: the dialogue `castSpell` test. */
export const staticSpellActive = (active: readonly ActiveLight[], slot: number, ticks: number): boolean =>
  STATIC_SPELLS[slot] !== undefined && spellActive(active, STATIC_SPELLS[slot]!, ticks);
