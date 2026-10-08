import type { Character, ConditionName } from '../formats/gam';
import { addCondition, activeCharacters, updateCharacter, type ItemRule, type PartyState } from './party';
import { TIMES, hourOfDay, restOneHour, type TimeReport, type WorldState } from './state';

/**
 * Shared rest maths for inns and camping: what a `TimeReport` does to the party's characters, and
 * a loop of one-hour rests. Semantics follow docs/formats/inns.md (BaKGL `bak/time.cpp`,
 * understood and re-expressed, not copied). Pure functions: inputs are never mutated.
 */

export const ITEM_RATIONS = 72;
export const ITEM_POISONED_RATIONS = 73;
export const ITEM_SPOILED_RATIONS = 74;

/** Health lost per lack-of-sleep hour, by character index (BaKGL order). */
const SLEEP_DAMAGE = [2, 1, 2, 2, 2, 3];

/**
 * Per condition, in `CONDITION_NAMES` order: [change per hour, health points per hour while it
 * is still above zero]. Sick, Plagued and Poisoned worsen and drain; Drunk and Healing fade.
 */
const CONDITION_EFFECT: readonly (readonly [number, number])[] = [
  [1, -1],
  [1, -2],
  [1, -3],
  [-2, 0],
  [-3, 1],
  [0, -2],
  [0, 0],
];
const CONDITION_NAMES_ORDER: readonly ConditionName[] = [
  'sick',
  'plagued',
  'poisoned',
  'drunk',
  'healing',
  'starving',
  'nearDeath',
];

/** Health and stamina are one pool for healing: health fills first, stamina holds the rest. */
export const healthPool = (c: Character): number => c.skills.health.trueSkill + c.skills.stamina.trueSkill;
export const healthPoolMax = (c: Character): number => c.skills.health.max + c.skills.stamina.max;

function withPool(c: Character, pool: number): Character {
  const { health, stamina } = c.skills;
  const total = Math.max(0, pool);
  const h = Math.min(total, health.max);
  const s = total > health.max ? total - health.max : 0;
  return {
    ...c,
    skills: { ...c.skills, health: { ...health, trueSkill: h }, stamina: { ...stamina, trueSkill: s } },
  };
}

/** Whether resting would still help: below the full pool in an inn, below 80 percent camping. */
export function canHeal(c: Character, inInn: boolean): boolean {
  return healthPool(c) < healthPoolMax(c) * (inInn ? 1 : 0.8);
}

/** Change a character's health pool by `amount` (negative hurts), honouring the near-death rules. */
function adjustPool(c: Character, amount: number, ceilingPercent: number): Character {
  let ceiling = Math.trunc((healthPoolMax(c) * ceilingPercent) / 100);
  const nearDeath = c.conditions.nearDeath;
  if (nearDeath !== 0) ceiling = Math.trunc(((100 - nearDeath) * 30) / 100) + 1;
  const pool = healthPool(c);
  if (amount <= 0) {
    const next = pool + amount;
    if (next <= 0) return addCondition(withPool(c, 0), 'nearDeath', 100);
    return withPool(c, next);
  }
  return pool < ceiling ? withPool(c, Math.min(pool + amount, ceiling)) : c;
}

/**
 * One game hour of conditions and healing. With `healFraction` 0 (walking) only conditions run.
 * Resting (`healFraction` > 0) cures 3 Sick first and heals `floor(fraction/100)` points, doubled
 * under Healing; `ceilingPercent` 80 caps camping at 80 percent of the pool.
 */
export function hourlyEffects(c: Character, healFraction: number, ceilingPercent: number): Character {
  let next = c;
  let heal = 0;
  let percent = 100;
  if (healFraction !== 0) {
    next = addCondition(next, 'sick', -3);
    percent = ceilingPercent === 0x50 || ceilingPercent === 80 ? 80 : 100;
    heal = Math.floor(healFraction / 100);
    if (next.conditions.healing > 0) heal *= 2;
  }
  CONDITION_NAMES_ORDER.forEach((name, i) => {
    if (next.conditions[name] <= 0) return;
    let change = CONDITION_EFFECT[i]![0];
    if (i < 4 && next.conditions.healing > 0) change -= i === 0 ? 3 : 2;
    next = addCondition(next, name, change);
    if (next.conditions[name] > 0) heal += CONDITION_EFFECT[i]![1];
  });
  return heal === 0 ? next : adjustPool(next, heal, percent);
}

/** Near death eases by one tenth of its distance from 100 each day (twice as fast under Healing). */
export function improveNearDeath(c: Character): Character {
  const value = c.conditions.nearDeath;
  if (value === 0) return c;
  let amount = Math.trunc((value - 100) / 10) - 1;
  if (c.conditions.healing > 0) amount *= 2;
  return addCondition(c, 'nearDeath', amount);
}

function takeOne(c: Character, itemIndex: number, rule: ItemRule | undefined): Character | undefined {
  const at = c.inventory.items.findIndex((it) => it.itemIndex === itemIndex);
  if (at < 0) return undefined;
  const it = c.inventory.items[at]!;
  const items = c.inventory.items.slice();
  if ((rule?.stackSize ?? 1) > 1 && it.conditionOrQuantity > 1)
    items[at] = { ...it, conditionOrQuantity: it.conditionOrQuantity - 1 };
  else items.splice(at, 1);
  return { ...c, inventory: { ...c.inventory, items } };
}

/** The daily meal: a ration clears Starving, a spoiled one also adds Sick, a poisoned one adds Poisoned, none adds Starving. */
export function eatRation(c: Character, rule: (item: number) => ItemRule | undefined): Character {
  const fresh = takeOne(c, ITEM_RATIONS, rule(ITEM_RATIONS));
  if (fresh) return addCondition(fresh, 'starving', -100);
  const spoiled = takeOne(c, ITEM_SPOILED_RATIONS, rule(ITEM_SPOILED_RATIONS));
  if (spoiled) return addCondition(addCondition(spoiled, 'starving', -100), 'sick', 3);
  const poisoned = takeOne(c, ITEM_POISONED_RATIONS, rule(ITEM_POISONED_RATIONS));
  if (poisoned) return addCondition(poisoned, 'poisoned', 4);
  return addCondition(c, 'starving', 5);
}

/** Rations of every kind the character carries. */
export function rationCount(c: Character): number {
  let n = 0;
  for (const it of c.inventory.items) {
    if (
      it.itemIndex === ITEM_RATIONS ||
      it.itemIndex === ITEM_POISONED_RATIONS ||
      it.itemIndex === ITEM_SPOILED_RATIONS
    ) {
      n += it.conditionOrQuantity > 0 && it.conditionOrQuantity < 255 ? it.conditionOrQuantity : 1;
    }
  }
  return n;
}

/** Apply what a time step reported to the active characters: day effects first, then the hourly ones. */
export function applyTimeReport(
  p: PartyState,
  r: TimeReport,
  rule: (item: number) => ItemRule | undefined = () => undefined,
): PartyState {
  let party = p;
  for (const c of activeCharacters(p)) {
    party = updateCharacter(party, c.index, (x) => {
      let n = x;
      if (r.improveHealthStamina) {
        const h = n.skills.health;
        const s = n.skills.stamina;
        n = {
          ...n,
          skills: {
            ...n.skills,
            health: { ...h, max: h.max + 1, trueSkill: h.trueSkill + 1 },
            stamina: { ...s, max: s.max + 1, trueSkill: s.trueSkill + 1 },
          },
        };
      }
      if (r.consumeRations) n = eatRation(n, rule);
      if (r.improveNearDeath) n = improveNearDeath(n);
      if (r.sleepDamage) n = adjustPool(n, -(SLEEP_DAMAGE[x.index] ?? 2), 100);
      if (r.hourlyHeal) n = hourlyEffects(n, r.hourlyHeal.healFraction, r.hourlyHeal.healPercentCeiling);
      return n;
    });
  }
  return party;
}

export interface RestOptions {
  inInn: boolean;
  /** Sleep until the clock reads this hour (a full day if it already does). */
  untilHour?: number;
  /** Camp until nobody can heal further. Ignored when `untilHour` is set. */
  untilHealed?: boolean;
  rule?: (item: number) => ItemRule | undefined;
}

export interface RestResult {
  world: WorldState;
  party: PartyState;
  hours: number;
}

const MAX_REST_HOURS = 48;

/**
 * Rest in one-hour steps (as the original does), applying each step to the party. Resting more
 * than 13 hours in one go cures Sick.
 */
export function rest(world: WorldState, party: PartyState, o: RestOptions): RestResult {
  const began = world.ticks;
  let w = world;
  let p = party;
  let hours = 0;
  const target = o.untilHour === undefined ? undefined : ((o.untilHour % 24) + 24) % 24;
  while (hours < MAX_REST_HOURS) {
    const step = restOneHour(w, o.inInn);
    w = step.state;
    p = applyTimeReport(p, step.report, o.rule);
    hours++;
    if (w.ticks - began > TIMES.thirteenHours) {
      for (const c of activeCharacters(p)) p = updateCharacter(p, c.index, (x) => addCondition(x, 'sick', -100));
    }
    if (
      target !== undefined
        ? hourOfDay(w.ticks) === target
        : o.untilHealed
          ? !activeCharacters(p).some((c) => canHeal(c, o.inInn))
          : true
    )
      break;
  }
  return { world: w, party: p, hours };
}
