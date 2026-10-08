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

/** Bits of an inventory item's `modifiers` byte (BaKGL's `Modifier`, bit n = entry n). */
export const ItemMod = {
  Flaming: 1 << 0,
  SteelFire: 1 << 1,
  Frost: 1 << 2,
  Enhancement1: 1 << 3,
  Enhancement2: 1 << 4,
  Blessing1: 1 << 5,
  Blessing2: 1 << 6,
  Blessing3: 1 << 7,
} as const;

/** OBJINFO index of Guarda Revanche, which does double damage to moredhel (monsters 18 and 21). */
export const GUARDA_REVANCHE = 22;
const isMoredhel = (monster: number | undefined): boolean => monster === 18 || monster === 21;

export interface WeaponStats {
  strengthSwing: number;
  strengthThrust: number;
  accuracySwing: number;
  accuracyThrust: number;
  /** 0 to 100. */
  condition: number;
  race: RaceKind;
  /** The item's OBJINFO index; only Guarda Revanche matters. */
  index?: number;
  /** Items that are not condition-based (staves) always count as 100 when working out accuracy. */
  conditionBased?: boolean;
  /** The inventory item's `modifiers` byte (see `ItemMod`). */
  modifiers?: number;
  poisoned?: boolean;
}

export interface ArmorStats {
  /** Armour defence rating (OBJINFO accuracy-swing field). */
  rating: number;
  /** 0 to 100. */
  condition: number;
  race: RaceKind;
  /** The inventory item's `modifiers` byte (see `ItemMod`). */
  modifiers?: number;
  poisoned?: boolean;
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
  /** Monster index; used for Guarda Revanche's bonus against moredhel. */
  monster?: number;
}

export type AttackKind = 'slash' | 'thrust';

const trunc = Math.trunc;

/** Percent multiplier of a blessing: 105, 110 or 115 (the highest one set), else 100. */
export function blessingPercent(modifiers = 0): number {
  if (modifiers & ItemMod.Blessing3) return 115;
  if (modifiers & ItemMod.Blessing2) return 110;
  if (modifiers & ItemMod.Blessing1) return 105;
  return 100;
}

/** Weapon accuracy after race and condition, in percentage points of the base accuracy. */
export function accuracyBonus(weapon: WeaponStats, wielder: RaceKind, kind: AttackKind): number {
  const base = kind === 'thrust' ? weapon.accuracyThrust : weapon.accuracySwing;
  const raced = trunc((base * (raceEffect(wielder, weapon.race) + 100)) / 100);
  const condition = weapon.conditionBased === false ? 100 : weapon.condition;
  return trunc((raced * condition) / 100);
}

/** Defender's parry: Defense / 4 (0 when it cannot act), raised by an armour blessing, capped at 98. */
export function parryValue(defender: MeleeStats): number {
  const base = defender.incapacitated ? 0 : trunc(defender.defense / 4);
  const parry = trunc((base * blessingPercent(defender.armor?.modifiers)) / 100);
  return Math.max(0, Math.min(98, parry));
}

/**
 * The attacker's score before the roll: (Melee + weapon bonus), raised by a weapon blessing, minus
 * the parry, clamped to 2..98.
 */
export function hitScore(attacker: MeleeStats, defender: MeleeStats, kind: AttackKind): number {
  const bonus = attacker.weapon ? accuracyBonus(attacker.weapon, attacker.race, kind) : 0;
  const skill = trunc(((attacker.melee + bonus) * blessingPercent(attacker.weapon?.modifiers)) / 100);
  return Math.max(2, Math.min(98, skill - parryValue(defender)));
}

/** A hit when a 0-99 roll (+20 against a defender who is defending) is below the score. */
export function rollToHit(attacker: MeleeStats, defender: MeleeStats, kind: AttackKind, roll: Roll): boolean {
  const r = roll(0, 99) + (defender.defending ? 20 : 0);
  return r < hitScore(attacker, defender, kind);
}

/**
 * Extra damage from an enchanted or poisoned weapon. A poisoned blade adds 10; an enchantment
 * replaces that: Flaming 75% of the weapon's strength, SteelFire 100%, Frost 50%, Enhancement1 200%,
 * Enhancement2 75% (the last one set wins). Armour carrying the same enchantment cancels it; armour
 * that is itself poisoned cancels a plain poison bonus.
 */
export function bonusDamage(weapon: WeaponStats, defender: MeleeStats | undefined, kind: AttackKind): number {
  const strength = kind === 'thrust' ? weapon.strengthThrust : weapon.strengthSwing;
  const mods = weapon.modifiers ?? 0;
  let bonus = weapon.poisoned ? 10 : 0;
  let active = 0;
  const table: [number, number][] = [
    [ItemMod.Flaming, trunc((strength * 75) / 100)],
    [ItemMod.SteelFire, strength],
    [ItemMod.Frost, trunc(strength / 2)],
    [ItemMod.Enhancement1, strength * 2],
    [ItemMod.Enhancement2, trunc((strength * 75) / 100)],
  ];
  for (const [bit, amount] of table) {
    if (mods & bit) {
      bonus = amount;
      active = bit;
    }
  }
  const armor = defender?.armor;
  if (armor && active) return (armor.modifiers ?? 0) & active ? 0 : bonus;
  if (armor && weapon.poisoned && armor.poisoned) return 0;
  return bonus;
}

/**
 * Strength plus the weapon's strength scaled by its condition, plus any enchantment bonus, doubled
 * for Guarda Revanche against moredhel; at least 1. Pass the defender to apply its armour's effect.
 */
export function meleeDamage(attacker: MeleeStats, kind: AttackKind, defender?: MeleeStats): number {
  let total = attacker.strength;
  const weapon = attacker.weapon;
  if (weapon) {
    const s = kind === 'thrust' ? weapon.strengthThrust : weapon.strengthSwing;
    total += trunc((s * weapon.condition) / 100);
    total += bonusDamage(weapon, defender, kind);
    if (weapon.index === GUARDA_REVANCHE && isMoredhel(defender?.monster)) total *= 2;
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

// --- Wear -----------------------------------------------------------------------------------

/** Share of a dull, out of 256: a thrust dulls the weapon by half, a slash and armour in full. */
export const DULL_FULL = 256;
export const DULL_HALF = 128;

export interface DullStats {
  /** Percent chance that a use wears the item at all. */
  dullChance: number;
  maxDullAmount: number;
  minCondition: number;
}

/**
 * Condition after one use of a weapon or armour. With probability `dullChance` percent it loses
 * 1 to `maxDullAmount - 1` points (always 1 when the maximum is 1), scaled by `factor / 256` and
 * rounded down; a crossbow may then snap outright (a 0-49 roll at or above its new condition);
 * the result never drops below `minCondition`; 0 means broken.
 */
export function dullCondition(
  condition: number,
  stats: DullStats,
  factor: number,
  roll: Roll,
  crossbow = false,
): number {
  if (roll(0, 99) >= stats.dullChance) return condition;
  let amount = stats.maxDullAmount > 1 ? roll(1, stats.maxDullAmount - 1) : 1;
  amount = trunc((amount * factor) / DULL_FULL);
  let next = condition - amount;
  if (crossbow && roll(0, 49) >= next) next = 0;
  if (next < stats.minCondition) next = stats.minCondition;
  return Math.max(0, next);
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

// --- Ranged attacks ------------------------------------------------------------------------
// BaKGL's grid code has no ranged attacks, so the numbers below are our own (**unverified**).
// Crossbows use no ammunition in BaK; a shot dulls the weapon like a melee hit does.

/** Farthest target, in cells (Chebyshev distance), a crossbow can reach. */
export const RANGED_RANGE = 8;
/** Hit-score points lost per cell beyond the first. */
export const RANGE_PENALTY = 3;

/** What the ranged rules need to know about a shooter. */
export interface RangedStats {
  /** Crossbow skill. */
  crossbow: number;
  weapon: WeaponStats;
}

/** Crossbow skill + weapon accuracy - range penalty - the target's parry, clamped to 2..98. */
export function rangedHitScore(shooter: RangedStats, defender: MeleeStats, distance: number): number {
  const bonus = accuracyBonus(shooter.weapon, RaceKind.None, 'thrust');
  const penalty = Math.max(0, distance - 1) * RANGE_PENALTY;
  return Math.max(2, Math.min(98, shooter.crossbow + bonus - penalty - parryValue(defender)));
}

export function rollToHitRanged(shooter: RangedStats, defender: MeleeStats, distance: number, roll: Roll): boolean {
  const r = roll(0, 99) + (defender.defending ? 20 : 0);
  return r < rangedHitScore(shooter, defender, distance);
}

/** The bolt's strength scaled by the crossbow's condition; Strength does not add. At least 1. */
export function rangedDamage(shooter: RangedStats): number {
  const w = shooter.weapon;
  return Math.max(1, trunc((Math.max(w.strengthThrust, w.strengthSwing) * w.condition) / 100));
}
