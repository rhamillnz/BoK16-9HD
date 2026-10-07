/**
 * Putting a combat encounter together: who fights, where they start, and what the fight does to
 * the party afterwards. Pure; the caller supplies the decoded tables.
 */

import type { Character } from '../formats/gam';
import type { SpellDef } from '../formats/spells';
import type { ItemDef } from '../formats/objinfo';
import type { PartyState } from '../game/party';
import { updateCharacter } from '../game/party';
import type { Fighter } from './battle';
import { retreatSide, type CombatDef, type EnemyRecord, type PartyGridSlot, type PlacedPosition } from './combatData';
import { TILE_SIZE } from '../formats/world';
import { COMBAT_GRID_COLS, COMBAT_GRID_ROWS } from './grid';
import { enemyFighter, freeCell, partyFighter } from './roster';
import { isDead } from './rules';

export interface SetupInput {
  def: CombatDef;
  /** The combat's monsters from the save; empty when the save holds none (a stand-in is made from `def`). */
  enemies: readonly EnemyRecord[];
  party: readonly Character[];
  partyGrid: readonly PartyGridSlot[];
  /** Monster names by monster index. */
  monsterNames: readonly string[];
  items: readonly ItemDef[];
  /** SPELLS.DAT; lets magic-users cast in the fight. */
  spells?: readonly SpellDef[];
}

const FALLBACK_SKILL = { max: 12, trueSkill: 12, modifier: 0 };

/** A generic fighter for a monster the save has no record of: modest skills, placed on the far rows. */
function standIn(def: CombatDef, i: number): EnemyRecord {
  const c = def.combatants[i]!;
  const skill = (v: number) => ({ max: v, trueSkill: v, modifier: 0 });
  return {
    combatant: -(i + 1),
    monster: c.monster,
    gridX: 1 + ((i * 2) % (COMBAT_GRID_COLS - 2)),
    gridY: COMBAT_GRID_ROWS - 3 - (i % 2),
    dead: false,
    retreatFactor: 0,
    skills: {
      health: skill(18), stamina: skill(14), speed: skill(5), strength: skill(8), defense: skill(24),
      crossbow: FALLBACK_SKILL, melee: skill(50), casting: FALLBACK_SKILL, assessment: FALLBACK_SKILL,
      armorcraft: FALLBACK_SKILL, weaponcraft: FALLBACK_SKILL, barding: FALLBACK_SKILL, haggling: FALLBACK_SKILL,
      lockpick: FALLBACK_SKILL, scouting: FALLBACK_SKILL, stealth: FALLBACK_SKILL,
    },
  };
}

/** The fighters of an encounter, party first then enemies, with no two sharing a cell. */
export function buildFighters(input: SetupInput): Fighter[] {
  const living = input.party.filter((c) => c.skills.health.trueSkill > 0);
  const fighters: Fighter[] = [];
  const taken: { x: number; y: number }[] = [];
  const place = (f: Fighter) => {
    f.pos = freeCell(taken, f.pos, COMBAT_GRID_COLS, COMBAT_GRID_ROWS);
    taken.push(f.pos);
    fighters.push(f);
  };
  living.forEach((c, i) => place(partyFighter(c, input.partyGrid[c.index], i, input.items, input.spells)));

  const records = input.enemies.length > 0 ? input.enemies.filter((e) => !e.dead) : input.def.combatants.map((_, i) => standIn(input.def, i));
  const seen = new Map<number, number>();
  for (const e of records) {
    const n = seen.get(e.monster) ?? 0;
    seen.set(e.monster, n + 1);
    place(enemyFighter(e, input.monsterNames[e.monster] ?? `Monster ${e.monster}`, n));
  }
  return fighters;
}

/**
 * Writes the fight's wounds back to the party: current Health and Stamina, and Near Death for
 * anyone who fell (BaKGL's death clean-up sets that condition).
 */
export function applyBattleToParty(party: PartyState, fighters: readonly Fighter[]): PartyState {
  let next = party;
  for (const f of fighters) {
    if (f.side !== 'party') continue;
    const index = Number(f.id.replace('party', ''));
    next = updateCharacter(next, index, (c) => ({
      ...c,
      skills: {
        ...c.skills,
        health: { ...c.skills.health, trueSkill: f.health },
        stamina: { ...c.skills.stamina, trueSkill: f.stamina },
      },
      conditions: isDead(f) ? { ...c.conditions, nearDeath: 100 } : c.conditions,
    }));
  }
  return next;
}

/**
 * Where the party stands after retreating: the retreat point on the side it came from, which the
 * combat table stores relative to the encounter's tile.
 */
export function retreatDestination(
  def: CombatDef,
  tile: { x: number; y: number },
  party: { x: number; y: number },
  centre: { x: number; y: number },
): PlacedPosition {
  const p = def.retreat[retreatSide(party, centre)];
  return { x: tile.x * TILE_SIZE + p.x, y: tile.y * TILE_SIZE + p.y, heading: p.heading };
}
