/**
 * Builds combat `Fighter`s from the party and from the save's enemy records.
 * Enemy weapons and armour live in the save's combat inventories, which are not parsed yet, so
 * monsters fight unarmed: damage is their Strength alone (**unverified** against the original).
 */

import { effectiveSkill, type Character, type InventoryItem } from '../formats/gam';
import type { SpellDef } from '../formats/spells';
import { isSpellcaster, knownSpells, spellKind } from '../game/spells';
import { ItemType, Race, type ItemDef } from '../formats/objinfo';
import type { Fighter } from './battle';
import type { EnemyRecord, PartyGridSlot } from './combatData';
import { Direction, type GridPos } from './grid';
import { monsterRace, RaceKind, type ArmorStats, type WeaponStats } from './rules';

const raceKind = (r: Race): RaceKind =>
  r >= Race.Tsurani && r <= Race.Human ? (r as unknown as RaceKind) : RaceKind.None;

/** The equipped sword or staff as weapon stats. */
export function equippedWeapon(items: readonly InventoryItem[], defs: readonly ItemDef[]): WeaponStats | undefined {
  for (const it of items) {
    const def = defs[it.itemIndex];
    if (!it.equipped || it.broken || !def || (def.type !== ItemType.Sword && def.type !== ItemType.Staff)) continue;
    return {
      strengthSwing: def.strengthSwing,
      strengthThrust: def.strengthThrust,
      accuracySwing: def.accuracySwing,
      accuracyThrust: def.accuracyThrust,
      condition: it.conditionOrQuantity,
      race: raceKind(def.race),
    };
  }
  return undefined;
}

/** The equipped crossbow (unbroken) as weapon stats; its bolt strength is the item's thrust strength. */
export function equippedCrossbow(items: readonly InventoryItem[], defs: readonly ItemDef[]): WeaponStats | undefined {
  for (const it of items) {
    const def = defs[it.itemIndex];
    if (!it.equipped || it.broken || !def || def.type !== ItemType.Crossbow) continue;
    return {
      strengthSwing: def.strengthSwing,
      strengthThrust: def.strengthThrust,
      accuracySwing: def.accuracySwing,
      accuracyThrust: def.accuracyThrust,
      condition: it.conditionOrQuantity,
      race: raceKind(def.race),
    };
  }
  return undefined;
}

/**
 * Monsters' weapons are not parsed (see the header), but a monster with a real Crossbow skill is
 * given this stand-in bolt so the enemy AI can shoot (**unverified**).
 */
export const MONSTER_BOLT: WeaponStats = {
  strengthSwing: 0,
  strengthThrust: 8,
  accuracySwing: 0,
  accuracyThrust: 0,
  condition: 100,
  race: RaceKind.None,
};
/** Crossbow skill from which a monster shoots. */
export const MONSTER_SHOOTER_SKILL = 30;

/** Casting skill from which a monster casts. */
export const MONSTER_CASTER_SKILL = 30;
/** A monster can afford a spell whose minimum cost is at most its Casting skill over this. */
export const MONSTER_CAST_DIVISOR = 3;

/**
 * Spells a monster casts (**unverified**: monster spell lists are not in the data we have read, and
 * BaKGL has no monster casting). A monster with Casting skill of `MONSTER_CASTER_SKILL` or more
 * knows every item-free damage or healing spell whose minimum cost is within a third of its skill,
 * and always at least the cheapest damage spell.
 */
export function monsterSpells(casting: number, defs: readonly SpellDef[]): SpellDef[] {
  if (casting < MONSTER_CASTER_SKILL) return [];
  const usable = defs.filter(
    (d) => d.objectRequired === undefined && (spellKind(d) === 'damage' || spellKind(d) === 'heal'),
  );
  const known = usable.filter((d) => d.minCost * MONSTER_CAST_DIVISOR <= casting);
  if (known.some((d) => spellKind(d) === 'damage')) return known;
  const cheapest = usable.filter((d) => spellKind(d) === 'damage').sort((a, b) => a.minCost - b.minCost)[0];
  return cheapest ? [...known, cheapest] : known;
}

/** The equipped armour; its rating is the item's accuracy-swing field. */
export function equippedArmor(items: readonly InventoryItem[], defs: readonly ItemDef[]): ArmorStats | undefined {
  for (const it of items) {
    const def = defs[it.itemIndex];
    if (!it.equipped || !def || def.type !== ItemType.Armor) continue;
    return { rating: def.accuracySwing, condition: it.conditionOrQuantity, race: raceKind(def.race) };
  }
  return undefined;
}

export function partyFighter(
  c: Character,
  slot: PartyGridSlot | undefined,
  index: number,
  defs: readonly ItemDef[],
  spells: readonly SpellDef[] = [],
): Fighter {
  const known = isSpellcaster(c) ? knownSpells(c, spells) : [];
  const skill = (n: Parameters<typeof effectiveSkill>[1]) => effectiveSkill(c, n);
  const bow = equippedCrossbow(c.inventory.items, defs);
  return {
    id: `party${c.index}`,
    side: 'party',
    name: c.name,
    monster: slot?.monster ?? 0,
    // P1.DAT cells when present; otherwise a row of cells at the south edge.
    pos: slot ? { x: slot.gridX, y: slot.gridY } : { x: 2 + index, y: 1 },
    facing: Direction.North,
    health: c.skills.health.trueSkill,
    maxHealth: c.skills.health.max,
    stamina: c.skills.stamina.trueSkill,
    maxStamina: c.skills.stamina.max,
    speed: skill('speed'),
    strength: skill('strength'),
    defense: skill('defense'),
    melee: skill('melee'),
    race: RaceKind.None,
    weapon: equippedWeapon(c.inventory.items, defs),
    armor: equippedArmor(c.inventory.items, defs),
    ...(known.length > 0 ? { spells: known } : {}),
    ...(bow ? { ranged: { crossbow: skill('crossbow'), weapon: bow } } : {}),
  };
}

export function enemyFighter(
  e: EnemyRecord,
  name: string,
  index: number,
  spellDefs: readonly SpellDef[] = [],
): Fighter {
  const v = (n: keyof EnemyRecord['skills']) => Math.max(0, e.skills[n].trueSkill + e.skills[n].modifier);
  const spells = monsterSpells(v('casting'), spellDefs);
  return {
    id: `enemy${e.combatant}`,
    side: 'enemy',
    name: `${name}${index > 0 ? ` ${index + 1}` : ''}`,
    monster: e.monster,
    pos: { x: e.gridX, y: e.gridY },
    facing: Direction.South,
    health: e.skills.health.trueSkill,
    maxHealth: e.skills.health.max,
    stamina: e.skills.stamina.trueSkill,
    maxStamina: e.skills.stamina.max,
    speed: v('speed'),
    strength: v('strength'),
    defense: v('defense'),
    melee: v('melee'),
    race: monsterRace(e.monster),
    ...(spells.length > 0 ? { spells } : {}),
    ...(v('crossbow') >= MONSTER_SHOOTER_SKILL ? { ranged: { crossbow: v('crossbow'), weapon: MONSTER_BOLT } } : {}),
  };
}

/** Nudge a starting cell to the nearest free one when two fighters were given the same cell. */
export function freeCell(taken: readonly GridPos[], want: GridPos, cols: number, rows: number): GridPos {
  const used = new Set(taken.map((p) => `${p.x},${p.y}`));
  for (let radius = 0; radius < Math.max(cols, rows); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const p = { x: want.x + dx, y: want.y + dy };
        if (p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows && !used.has(`${p.x},${p.y}`)) return p;
      }
    }
  }
  return want;
}
