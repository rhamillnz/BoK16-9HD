/**
 * Combat turn order and round flow. See docs/formats/combat.md.
 *
 * Pure state transitions over a list of combatants; no randomness (poison damage is passed in).
 * Rules follow what BaKGL implements (reference only; this code is our own).
 */

import type { Side } from './grid';

export interface TurnCombatant {
  id: string;
  side: Side;
  /** Current Speed skill. Zero counts as 1 for ordering. */
  speed: number;
  /** Has not yet acted this round. */
  turnPending: boolean;
  dead: boolean;
  poisoned: boolean;
  /** Banished (e.g. ghosts): skipped for the rest of the combat, not counted as dead. */
  exorcised: boolean;
  /**
   * Under a spell that takes the combatant out of the fight without killing it
   * (Dannon's Delusions, Despair Thy Eyes, Grief of 1000 Nights in BaKGL).
   */
  incapacitated: boolean;
  /** Left via the retreat command. */
  fled: boolean;
  defending: boolean;
  /** Remaining health; only used for poison. */
  health: number;
}

export function newCombatant(id: string, side: Side, speed: number, health = 1): TurnCombatant {
  return {
    id,
    side,
    speed,
    health,
    turnPending: true,
    dead: false,
    poisoned: false,
    exorcised: false,
    incapacitated: false,
    fled: false,
    defending: false,
  };
}

function effectiveSpeed(c: TurnCombatant): number {
  return c.speed === 0 ? 1 : c.speed;
}

/** Can act now: still has its turn this round, alive, and not incapacitated, exorcised or fled. */
export function isActive(c: TurnCombatant): boolean {
  return c.turnPending && !c.dead && !c.incapacitated && !c.exorcised && !c.fled;
}

/**
 * The next combatant to act: the fastest of those still pending. Ties go to the one later in the
 * list. `onlyParty` restricts the choice to the player's side (used for the first turn of a combat).
 */
export function selectNextCombatant(combatants: readonly TurnCombatant[], onlyParty = false): number {
  let best = -1;
  let bestSpeed = -1;
  combatants.forEach((c, i) => {
    if (!isActive(c)) return;
    if (onlyParty && c.side !== 'party') return;
    const speed = effectiveSpeed(c);
    if (speed >= bestSpeed) {
      bestSpeed = speed;
      best = i;
    }
  });
  return best;
}

/** The full order the current round would run in, assuming speeds do not change. */
export function roundOrder(combatants: readonly TurnCombatant[]): number[] {
  const indices = combatants.map((_, i) => i).filter((i) => isActive(combatants[i]!));
  return indices.sort((a, b) => effectiveSpeed(combatants[b]!) - effectiveSpeed(combatants[a]!) || b - a);
}

/** Begins a new round: everyone alive and not exorcised gets a turn again, and defending ends. */
export function startNextRound(combatants: readonly TurnCombatant[]): TurnCombatant[] {
  return combatants.map((c) => (c.dead || c.exorcised ? c : { ...c, turnPending: true, defending: false }));
}

export type CombatOutcome = 'won' | 'dead' | 'fled';

/** Combat is over when one side has no living members. Fleeing is handled by `retreat`. */
export function checkCombatFinished(combatants: readonly TurnCombatant[]): CombatOutcome | undefined {
  const standing = (side: Side) => combatants.some((c) => c.side === side && !c.dead && !c.fled && !c.exorcised);
  if (!standing('party')) return 'dead';
  if (!standing('enemy')) return 'won';
  return undefined;
}

export interface TurnState {
  combatants: TurnCombatant[];
  /** Index of the combatant whose turn it is. */
  current: number;
  /** 1-based round counter. */
  round: number;
  outcome?: CombatOutcome;
}

/** Starts a combat: the fastest party member acts first. */
export function beginCombat(combatants: readonly TurnCombatant[]): TurnState {
  const list = combatants.map((c) => ({ ...c }));
  const current = selectNextCombatant(list, true);
  if (current < 0) throw new Error('combat needs at least one active party member');
  return { combatants: list, current, round: 1 };
}

export interface FinishTurnOptions {
  /** Damage dealt to the current combatant at the end of its turn if it is poisoned (BaKGL rolls 1 to 2). */
  poisonDamage?: number;
}

/**
 * Ends the current combatant's turn: marks it done, applies poison, checks whether combat is over,
 * then picks the next combatant, starting a new round when everyone has acted.
 */
export function finishTurn(state: TurnState, opts: FinishTurnOptions = {}): TurnState {
  if (state.outcome) return state;
  let combatants = state.combatants.map((c, i) => (i === state.current ? { ...c, turnPending: false } : c));
  const me = combatants[state.current]!;
  if (!me.dead && me.poisoned) {
    const health = me.health - (opts.poisonDamage ?? 1);
    combatants[state.current] = { ...me, health, dead: health <= 0 };
  }

  const outcome = checkCombatFinished(combatants);
  if (outcome) return { ...state, combatants, outcome };

  let round = state.round;
  let next = selectNextCombatant(combatants);
  if (next < 0) {
    combatants = startNextRound(combatants);
    round += 1;
    next = selectNextCombatant(combatants);
  }
  return { combatants, current: next < 0 ? state.current : next, round };
}

/** Marks a combatant dead, e.g. after taking lethal damage. Does not end the turn. */
export function killCombatant(state: TurnState, index: number): TurnState {
  const combatants = state.combatants.map((c, i) => (i === index ? { ...c, dead: true } : c));
  return { ...state, combatants };
}

/**
 * Defending ends the turn. Attackers then add 20 to their hit roll against the defender, which
 * makes a hit less likely (BaKGL). BaKGL never clears the flag; we clear it when the next round
 * begins, which is our assumption about the original.
 */
export function defend(state: TurnState): TurnState {
  const combatants = state.combatants.map((c, i) => (i === state.current ? { ...c, defending: true } : c));
  return finishTurn({ ...state, combatants });
}

/** Skipping a turn (rest) just ends it. */
export function rest(state: TurnState): TurnState {
  return finishTurn(state);
}

/** The party escapes: BaKGL always succeeds unless more than one party member is dead. */
export function canFlee(combatants: readonly TurnCombatant[]): boolean {
  return combatants.filter((c) => c.side === 'party' && c.dead).length <= 1;
}

/** Ends the combat as a retreat when allowed; otherwise returns the state unchanged. */
export function flee(state: TurnState): TurnState {
  if (state.outcome || !canFlee(state.combatants)) return state;
  return { ...state, outcome: 'fled' };
}
