import type { ItemDef } from '../formats/objinfo';
import {
  REST_CURES_SICK_AFTER,
  hoursUntil,
  restOneHour,
  type TimeReport,
  type WorldState,
} from './state';
import { activeCharacters, addCondition, removeItem, updateCharacter, type PartyState } from './party';
import { applyTimeReport, canHeal } from './rest';

/**
 * Camping in the wild (R key). Pure functions over `WorldState` and `PartyState`; the DOM-free
 * rules live here and `campControls.ts` wires them to the game. See docs/formats/camping.md.
 *
 * Healing, conditions, near death, skill growth and the 13 hour Sick cure use the same rules as
 * inns (`rest.ts`, `applyTimeReport`). Camping adds its own ration sharing across the party, the
 * ambush chance and the morning hour (the last two are *estimated*, not read from the original).
 */

/** ItemType.Ration in OBJINFO. */
export const ITEM_TYPE_RATION = 0x17;
/** Hour of day "rest until morning" stops at. */
export const MORNING_HOUR = 6;
/** Chance per camped hour that something finds the camp (estimate). */
export const AMBUSH_CHANCE_PER_HOUR = 0.04;
/** Starving points added to a character with no ration at a day boundary. */
export const STARVE_PENALTY = 5;
/** Longest single camp, in hours. */
export const MAX_CAMP_HOURS = 24;

export type CampPlan =
  | { kind: 'hours'; hours: number }
  | { kind: 'morning' }
  | { kind: 'healed' };

export interface CampOptions {
  items: readonly ItemDef[];
  /** 0..1 random source; injected for tests. */
  random?: () => number;
  /** Chance of an interruption per hour; 0 disables. */
  ambushChance?: number;
}

export interface CampResult {
  world: WorldState;
  party: PartyState;
  hoursRested: number;
  /** An ambush cut the rest short. */
  interrupted: boolean;
  /** Lines for the report box, in order. */
  messages: string[];
}

/** Hours a plan asks for given the current world time (before interruptions). */
export function plannedHours(plan: CampPlan, world: WorldState, party: PartyState): number {
  if (plan.kind === 'hours') return Math.max(1, Math.min(MAX_CAMP_HOURS, Math.floor(plan.hours)));
  if (plan.kind === 'morning') return hoursUntil(world.ticks, MORNING_HOUR);
  // Until everyone is healed: the camp loop stops as soon as nobody can heal further.
  void party;
  return MAX_CAMP_HOURS;
}

/** Day boundary: every active character eats a ration (clearing Starving) or goes hungrier. */
function eatRations(party: PartyState, items: readonly ItemDef[], messages: string[]): PartyState {
  let p = party;
  for (const c of activeCharacters(party)) {
    const ration = findRation(p, c.index, items);
    if (ration) {
      p = removeItem(p, ration, 1, { stackSize: items[ration]?.stackSize ?? 1, defaultStackSize: items[ration]?.defaultStackSize ?? 1, isKey: false });
      p = updateCharacter(p, c.index, (x) => addCondition(x, 'starving', -100));
    } else {
      p = updateCharacter(p, c.index, (x) => addCondition(x, 'starving', STARVE_PENALTY));
      messages.push(`${c.name} has no ration and goes hungry.`);
    }
  }
  return p;
}

/** The ration item index a character would eat: their own first, then anyone's in the active party. */
function findRation(party: PartyState, who: number, items: readonly ItemDef[]): number | undefined {
  const isRation = (index: number) => items[index]?.type === ITEM_TYPE_RATION;
  const own = party.characters.find((c) => c.index === who)?.inventory.items.find((i) => isRation(i.itemIndex));
  if (own) return own.itemIndex;
  for (const c of activeCharacters(party)) {
    const it = c.inventory.items.find((i) => isRation(i.itemIndex));
    if (it) return it.itemIndex;
  }
  return undefined;
}

/** Rations the active party carries (counting stacks). */
export function countRations(party: PartyState, items: readonly ItemDef[]): number {
  let n = 0;
  for (const c of activeCharacters(party)) {
    for (const it of c.inventory.items) {
      if (items[it.itemIndex]?.type !== ITEM_TYPE_RATION) continue;
      n += (items[it.itemIndex]!.stackSize ?? 1) > 1 ? it.conditionOrQuantity : 1;
    }
  }
  return n;
}

function applyReport(party: PartyState, report: TimeReport, items: readonly ItemDef[], messages: string[]): PartyState {
  // The shared rules handle healing, conditions, near death and growth; camping shares rations itself.
  const p = applyTimeReport(party, { ...report, consumeRations: false });
  return report.consumeRations ? eatRations(p, items, messages) : p;
}

/**
 * Camp according to `plan`. Runs one-hour steps (the original ignores longer deltas), applying the
 * time report to the party each hour, and stops early when an ambush interrupts. A camp of more than
 * 13 hours cures Sick.
 */
export function camp(world: WorldState, party: PartyState, plan: CampPlan, opts: CampOptions): CampResult {
  const random = opts.random ?? Math.random;
  const chance = opts.ambushChance ?? AMBUSH_CHANCE_PER_HOUR;
  const messages: string[] = [];
  const hours = plannedHours(plan, world, party);
  const startTicks = world.ticks;
  const healed = (p: PartyState) => !activeCharacters(p).some((c) => canHeal(c, false));

  let w = world;
  let p = party;
  let rested = 0;
  let interrupted = false;
  for (let h = 0; h < hours; h++) {
    const step = restOneHour(w, false);
    w = step.state;
    p = applyReport(p, step.report, opts.items, messages);
    rested++;
    if (plan.kind === 'healed' && healed(p)) break;
    if (chance > 0 && h < hours - 1 && random() < chance) {
      interrupted = true;
      break;
    }
  }

  if (w.ticks - startTicks > REST_CURES_SICK_AFTER) {
    for (const c of activeCharacters(p)) {
      if (c.conditions.sick > 0) p = updateCharacter(p, c.index, (x) => addCondition(x, 'sick', -100));
    }
    messages.push('A long rest cures the sick.');
  }
  return { world: w, party: p, hoursRested: rested, interrupted, messages };
}

/** One-line summary for the report box. */
export function campSummary(r: CampResult, before: PartyState, after: PartyState): string[] {
  const lines = [
    r.interrupted
      ? `The camp was disturbed after ${r.hoursRested} hour${r.hoursRested === 1 ? '' : 's'}!`
      : `The party rested ${r.hoursRested} hour${r.hoursRested === 1 ? '' : 's'}.`,
  ];
  for (const c of activeCharacters(after)) {
    const was = before.characters.find((x) => x.index === c.index)?.skills.health.trueSkill ?? 0;
    const gained = c.skills.health.trueSkill - was;
    if (gained > 0) lines.push(`${c.name} recovers ${gained} health.`);
  }
  lines.push(...r.messages);
  return lines;
}
