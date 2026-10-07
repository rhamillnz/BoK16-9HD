/**
 * Melee rules: hit chance, damage and armour. Follows the formulas BaKGL implements (reference only,
 * written independently); see docs/formats/combat.md. Pure; randomness is passed in as a `Roll`.
 */

/** Uniform integer in [lo, hi]. */
export type Roll = (lo: number, hi: number) => number;

/** A `Roll` backed by a [0, 1) source such as Math.random. */
export function rollFrom(random: () => number): Roll {
  return (lo, hi) => lo + Math.min(hi - lo, Math.floor(random() * (hi - lo + 1)));
}

/** Race ids used by the race-effect table (not OBJINFO's Race enum, which has more entries). */
export const RaceKind = { None: 0, Tsurani: 1, Elf: 2, Human: 3 } as const;
export type RaceKind = (typeof RaceKind)[keyof typeof RaceKind];

/** Item race (rows: wielder, columns: item race) to accuracy adjustment in percent. */
const RACE_EFFECT: readonly (readonly number[])[] = [
  [0, -1, -1, -2],
  [-1, 0, -1, -2],
  [-1, -1, 0, -2],
];

/** Wielder race by monster index: gorath 15 and moredhel 18, 21 are elves; everything else is None. */
export function monsterRace(monster: number): RaceKind {
  return monster === 15 || monster === 18 || monster === 21 ? RaceKind.Elf : RaceKind.None;
}

export function raceEffect(wielder: RaceKind, item: RaceKind): number {
  return RACE_EFFECT[wielder]?.[item] ?? 0;
}

export interface WeaponStats {
  strengthSwing: number;
  strengthThrust: number;
  accuracySwing: number;
  accuracyThrust: number;
  /** 0 to 100. */
  condition: number;
  race: RaceKind;
}

export interface ArmorStats {
  /** Armour defence rating (OBJINFO accuracy-swing field). */
  rating: number;
  /** 0 to 100. */
  condition: number;
  race: RaceKind;
}

/** What the melee rules need to know about a combatant. */
export interface MeleeStats {
  melee: number;
  strength: number;
  defense: number;
  race: RaceKind;
  weapon?: WeaponStats;
  armor?: ArmorStats;
  /** Banished, charmed or otherwise unable to parry. */
  incapacitated?: boolean;
  defending?: boolean;
}

export type AttackKind = 'slash' | 'thrust';

const trunc = Math.trunc;

/** Weapon accuracy after race and condition, in percentage points of the base accuracy. */
export function accuracyBonus(weapon: WeaponStats, wielder: RaceKind, kind: AttackKind): number {
  const base = kind === 'thrust' ? weapon.accuracyThrust : weapon.accuracySwing;
  const raced = trunc((base * (raceEffect(wielder, weapon.race) + 100)) / 100);
  return trunc((raced * weapon.condition) / 100);
}

/** Defender's parry: Defense / 4, nothing when it cannot act, capped at 98. */
export function parryValue(defender: MeleeStats): number {
  const parry = defender.incapacitated ? 0 : trunc(defender.defense / 4);
  return Math.max(0, Math.min(98, parry));
}

/** The attacker's score before the roll: Melee + weapon bonus - parry, clamped to 2..98. */
export function hitScore(attacker: MeleeStats, defender: MeleeStats, kind: AttackKind): number {
  const bonus = attacker.weapon ? accuracyBonus(attacker.weapon, attacker.race, kind) : 0;
  return Math.max(2, Math.min(98, attacker.melee + bonus - parryValue(defender)));
}

/** A hit when a 0-99 roll (+20 against a defender who is defending) is below the score. */
export function rollToHit(attacker: MeleeStats, defender: MeleeStats, kind: AttackKind, roll: Roll): boolean {
  const r = roll(0, 99) + (defender.defending ? 20 : 0);
  return r < hitScore(attacker, defender, kind);
}

/** Strength plus the weapon's strength scaled by its condition; at least 1. */
export function meleeDamage(attacker: MeleeStats, kind: AttackKind): number {
  let total = attacker.strength;
  if (attacker.weapon) {
    const s = kind === 'thrust' ? attacker.weapon.strengthThrust : attacker.weapon.strengthSwing;
    total += trunc((s * attacker.weapon.condition) / 100);
  }
  return Math.max(1, total);
}

/** Percent of damage absorbed: Defense / 4 plus armour rating by condition, scaled by race, cap 98. */
export function armorReduction(defender: MeleeStats): number {
  const armor = defender.armor;
  if (!armor) return 0;
  let reduction = trunc(defender.defense / 4) + trunc((armor.condition * armor.rating) / 100);
  reduction = trunc((reduction * (raceEffect(defender.race, armor.race) + 100)) / 100);
  return Math.min(98, reduction);
}

/** Damage after armour. A hit that armour would cancel still does 1 or 2. */
export function reduceDamage(damage: number, defender: MeleeStats, roll: Roll): number {
  const reduced = trunc((damage * (100 - armorReduction(defender))) / 100);
  return reduced <= 0 ? roll(1, 2) : reduced;
}

export interface VitalPool {
  health: number;
  stamina: number;
}

/** Damage drains Stamina first; what is left over comes off Health (never below 0). */
export function applyDamage(pool: VitalPool, damage: number): VitalPool {
  if (damage <= 0) return pool;
  if (pool.stamina >= damage) return { health: pool.health, stamina: pool.stamina - damage };
  const excess = damage - pool.stamina;
  return { health: Math.max(0, pool.health - excess), stamina: 0 };
}

export const isDead = (pool: VitalPool): boolean => pool.health <= 0;
