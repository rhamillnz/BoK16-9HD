/**
 * One fight on the combat grid: fighters, whose turn it is, and the actions a turn can take
 * (move, melee attack, defend, rest, flee). Pure state transitions over `BattleState`; the grid
 * and turn rules live in grid.ts and turns.ts, the melee maths in rules.ts. See docs/formats/combat.md.
 */

import type { SpellDef } from '../formats/spells';
import {
  BANISHES,
  BLACK_SLAYER,
  carriesFor,
  FINAL_REST,
  GIFT_OF_SUNG,
  GRIEF,
  INFINITY_POOL,
  INFINITY_POOL_BONUS,
  LIGHTNING_STAFF,
  maxPower,
  MINDLESS_MONSTERS,
  NIGHTHAWKS,
  SKYFIRE,
  SPELL_SPLASH,
  spellAmount,
  spellKind,
  SUMMONS,
} from '../game/spells';
import {
  buildGrid,
  chebyshevDistance,
  calculatePath,
  directionBetween,
  planAttack,
  samePos,
  selectAttackPosition,
  type CombatGrid,
  type Direction,
  type GridPos,
  type Side,
} from './grid';
import {
  applyDamage,
  isDead,
  meleeDamage,
  reduceDamage,
  rollToHit,
  type AttackKind,
  type MeleeStats,
  type RangedStats,
  type Roll,
  RANGED_RANGE,
  rangedDamage,
  rollToHitRanged,
  HitFlag,
  hitEffect,
  type HitEffect,
  monsterDamage,
  resistsPoison,
  weaponHitFlags,
} from './rules';
import {
  beginCombat,
  canFlee,
  finishTurn,
  newCombatant,
  type CombatOutcome,
  type Initiative,
  type TurnState,
} from './turns';

export interface Fighter extends MeleeStats {
  id: string;
  side: Side;
  name: string;
  /** Monster index; picks the combat sprite. */
  monster: number;
  pos: GridPos;
  facing: Direction;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  speed: number;
  /** A crossbow and the shooter's Crossbow skill; absent when the fighter cannot shoot. */
  ranged?: RangedStats;
  /** Spells a magic-user knows (combat ones are castable here); absent for everyone else. */
  spells?: SpellDef[];
  /** An enemy's position in its combat's enemy list (its combat inventory). */
  slot?: number;
  /** Turns this fighter still loses to a hold spell (blinded, held). */
  held?: number;
  /** Shield points from a ward spell, used up by damage before Health and Stamina. */
  ward?: number;
  /** Turns this fighter still cannot cast (Thoughts Like Clouds). */
  silenced?: number;
  /** Hostile spells aimed at this fighter rebound on their caster (Mirror Wall). */
  mirror?: boolean;
  /** Driven from the fight by a spell: gone, but neither slain nor searchable. */
  banished?: boolean;
  /** Item indices a party member carries (spells that need an item check these). */
  items?: number[];
  /** Brought into the fight by a spell (River Song, Dannon's Delusions); not a party member. */
  summoned?: boolean;
  /** Assessment skill: how much the Assess action reveals (manual p. 28). */
  assessment?: number;
  /** Casting Accuracy: the chance a line-of-sight spell lands (manual p. 28); absent means it always lands. */
  casting?: number;
  /** An enemy's readiness to run when hurt (the save's retreat factor, 0 to 9); absent or 0: it holds. */
  retreat?: number;
  /** Ran from the fight: gone, alive and not searchable. */
  fled?: boolean;
  /** Id of the attacker whose blow this fighter parried: its next attack on it gets a riposte bonus. */
  riposte?: string;
  /** A slain Nighthawk or Black Slayer that will rise again at the next round unless given Final Rest. */
  rising?: boolean;
  /** Given Final Rest: it stays dead (and its body can be searched). */
  laidToRest?: boolean;
  /** Poisoned: loses POISON_PER_TURN at the end of each of its turns (manual p. 51: worse in a fight). */
  poisoned?: boolean;
}

/** Health/Stamina a poisoned fighter loses at the end of each of its turns. */
export const POISON_PER_TURN = 2;

/** A fallen Black Slayer rises again; a fallen Nighthawk rises as one while any Black Slayer fights on its side. */
function willRise(fighters: readonly Fighter[], f: Fighter): boolean {
  if (!isDead(f) || f.banished || f.fled || f.laidToRest) return false;
  if (f.monster === BLACK_SLAYER) return true;
  return (
    NIGHTHAWKS.includes(f.monster) &&
    fighters.some((o) => o.side === f.side && o.monster === BLACK_SLAYER && !isDead(o))
  );
}

/** Out of the fight: slain, banished or run away. */
export const gone = (f: Fighter): boolean => isDead(f) || f.fled === true;

/** Hit-roll points and damage share of a riposte (manual p. 50: "slightly greater than normal"). */
export const RIPOSTE_BONUS = 10;
export const RIPOSTE_DAMAGE = 1.25;
/** Chance (percent) a missed bolt strikes someone next to its target instead (manual p. 50). */
export const STRAY_CHANCE = 35;

/** A free cell next to `p`: on the grid, not blocked terrain, no living fighter on it. */
function freeCellNear(s: BattleState, p: GridPos): GridPos | undefined {
  const grid = gridFor(s);
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [1, -1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const c = { x: p.x + dx, y: p.y + dy };
    if (c.x < 0 || c.y < 0 || c.x >= grid.cols || c.y >= grid.rows) continue;
    if (grid.cells[c.y * grid.cols + c.x]!.disabled) continue;
    if (s.fighters.some((f) => !gone(f) && samePos(f.pos, c))) continue;
    return c;
  }
  return undefined;
}

/** The fighter a summoning spell brings in at `pos` (stats ours, **unverified**). */
function summonedFighter(s: BattleState, caster: Fighter, spell: number, power: number, pos: GridPos): Fighter {
  const kind = SUMMONS[spell]!;
  const base = {
    id: `summon${s.fighters.length}`,
    side: caster.side,
    pos,
    facing: caster.facing,
    race: caster.race,
    summoned: true,
  };
  if (kind.illusion)
    return {
      ...base,
      name: `${caster.name}'s double`,
      monster: caster.monster,
      health: power * 2,
      maxHealth: power * 2,
      stamina: 0,
      maxStamina: 0,
      speed: caster.speed,
      strength: 1,
      defense: caster.defense,
      melee: caster.melee,
    };
  return {
    ...base,
    name: kind.name ?? 'Summoned',
    monster: kind.monster ?? caster.monster,
    health: 40,
    maxHealth: 40,
    stamina: 20,
    maxStamina: 20,
    speed: 6,
    strength: 20,
    defense: 30,
    melee: 70,
  };
}

/** Damage after the victim's ward soaks up what it can; lowers the ward. */
function warded(victim: Fighter, damage: number): number {
  const soak = Math.min(victim.ward ?? 0, damage);
  if (soak > 0) victim.ward = victim.ward! - soak;
  return damage - soak;
}

export type BattleEvent =
  | { type: 'move'; id: string; from: GridPos; path: GridPos[] }
  | {
      type: 'attack';
      attacker: string;
      target: string;
      kind: AttackKind;
      hit: boolean;
      damage: number;
      killed: boolean;
      /** An enchanted or poisoned blow that landed. */
      effect?: HitEffect;
    }
  | {
      type: 'shoot';
      attacker: string;
      target: string;
      hit: boolean;
      damage: number;
      killed: boolean;
      distance: number;
      /** A missed bolt that struck someone else next to the target. */
      stray?: { target: string; damage: number; killed: boolean };
    }
  | {
      type: 'cast';
      caster: string;
      target: string;
      spell: string;
      power: number;
      kind: CastKind;
      amount: number;
      killed: boolean;
      /** Other enemies an area spell struck, with the damage each took. */
      also?: { target: string; amount: number; killed: boolean }[];
      /** A Mirror Wall on the intended target turned the spell back: `target` is the caster. */
      reflected?: string;
      /** Id of the fighter a summoning spell brought in. */
      summoned?: string;
      /** A line-of-sight spell that missed (Casting Accuracy). */
      missed?: boolean;
    }
  | { type: 'defend'; id: string }
  | { type: 'rest'; id: string; healed: number }
  | { type: 'assess'; id: string; target: string; facts: string[] }
  | { type: 'retreat'; id: string }
  | { type: 'rise'; id: string }
  | { type: 'poison'; id: string; damage: number; killed: boolean }
  | { type: 'held'; id: string }
  | { type: 'flee'; success: boolean; refused?: boolean }
  | { type: 'round'; round: number }
  | { type: 'end'; outcome: CombatOutcome };

export interface BattleState {
  /** Fighters and `turn.combatants` share an index. */
  fighters: Fighter[];
  turn: TurnState;
  disabled: GridPos[];
  /** Events produced by the last action, oldest first. */
  events: BattleEvent[];
  /** Every event of the fight so far (what rewards and wear are worked out from). */
  history: BattleEvent[];
}

/**
 * Starts a fight. `initiative` says who caught whom off guard (see Initiative); without one the party's fastest
 * member goes first, then everyone in Speed order.
 */
export function startBattle(
  fighters: readonly Fighter[],
  disabled: readonly GridPos[] = [],
  initiative?: Initiative,
): BattleState {
  const list = fighters.map((f) => ({ ...f }));
  const turn = beginCombat(
    list.map((f) => ({ ...newCombatant(f.id, f.side, f.speed, f.health), dead: isDead(f) })),
    initiative,
  );
  // Normalised once, so anyone who starts the fight already fallen is treated like one slain in it.
  return sync({ fighters: list, turn, disabled: [...disabled], events: [], history: [] }, list, turn, []);
}

export const currentFighter = (s: BattleState): Fighter => s.fighters[s.turn.current]!;
export const isOver = (s: BattleState): boolean => s.turn.outcome !== undefined;

export function fighterAt(s: BattleState, p: GridPos): Fighter | undefined {
  return s.fighters.find((f) => !gone(f) && samePos(f.pos, p));
}

/** A living enemy stands on a neighbouring cell (including diagonals). */
export function nextToEnemy(s: BattleState, index = s.turn.current): boolean {
  const me = s.fighters[index]!;
  return s.fighters.some((f) => f.side !== me.side && !gone(f) && chebyshevDistance(me.pos, f.pos) <= 1);
}

/** The cells a straight line from `a` to `b` passes through, excluding both ends. */
export function cellsBetween(a: GridPos, b: GridPos): GridPos[] {
  const out: GridPos[] = [];
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let i = 1; i < n; i++) {
    const p = { x: Math.round(a.x + ((b.x - a.x) * i) / n), y: Math.round(a.y + ((b.y - a.y) * i) / n) };
    if (!out.some((q) => samePos(q, p))) out.push(p);
  }
  return out;
}

/** Nobody and nothing stands between `a` and `b` (manual p. 45: a character or object blocks a shot). */
export function lineOfSight(s: BattleState, a: GridPos, b: GridPos): boolean {
  return cellsBetween(a, b).every(
    (c) => !s.disabled.some((d) => samePos(d, c)) && !s.fighters.some((f) => !gone(f) && samePos(f.pos, c)),
  );
}

/** Cell flags for the current fighter's turn. */
export function gridFor(s: BattleState, index = s.turn.current): CombatGrid {
  const me = s.fighters[index]!;
  return buildGrid({
    disabled: s.disabled,
    occupants: s.fighters.map((f) => ({ id: f.id, pos: f.pos, side: f.side, dead: gone(f) })),
    mover: { id: me.id, side: me.side, speed: me.speed },
  });
}

/** Copies fighter vitals into the turn state and the turn state's defending flag back to the fighters. */
function sync(s: BattleState, fighters: Fighter[], turn: TurnState, events: BattleEvent[]): BattleState {
  // The undead that will rise are down, not dead: the fight goes on while they lie there.
  fighters = fighters.map((f) => (!f.rising && willRise(fighters, f) ? { ...f, rising: true } : f));
  const combatants = turn.combatants.map((c, i) => ({
    ...c,
    dead: isDead(fighters[i]!) && !fighters[i]!.banished && !fighters[i]!.rising,
    // Nothing else sets it: lying down waiting to rise is the only way to be out of the turn order but not dead.
    incapacitated: fighters[i]!.rising === true,
    exorcised: c.exorcised || fighters[i]!.banished === true,
    health: fighters[i]!.health,
  }));
  const synced = fighters.map((f, i) =>
    f.defending === combatants[i]!.defending ? f : { ...f, defending: combatants[i]!.defending },
  );
  return { ...s, fighters: synced, turn: { ...turn, combatants }, events, history: [...s.history, ...events] };
}

/** Ends the current turn, reporting a new round or the end of the fight. */
function endTurn(s: BattleState, fighters: Fighter[], events: BattleEvent[], turn: TurnState = s.turn): BattleState {
  const i = s.turn.current;
  if ((fighters[i]?.silenced ?? 0) > 0)
    fighters = fighters.map((f, k) => (k === i ? { ...f, silenced: f.silenced! - 1 } : f));
  // A riposte lasts until the fighter's own next action is over.
  fighters = fighters.map((f, k) => (k === i && f.riposte ? { ...f, riposte: undefined } : f));
  // Poison works on a fighter at the end of each of its turns.
  const me = fighters[i];
  if (me?.poisoned && !gone(me)) {
    const hurt = { ...me, ...applyDamage(me, POISON_PER_TURN) };
    fighters = fighters.map((f, k) => (k === i ? hurt : f));
    events = [...events, { type: 'poison', id: me.id, damage: POISON_PER_TURN, killed: isDead(hurt) }];
  }
  const synced = sync(s, fighters, turn, events);
  const before = synced.turn.round;
  let next = finishTurn(synced.turn);
  const out = [...events];
  let list = synced.fighters;
  if (next.round !== before && !next.outcome) {
    out.push({ type: 'round', round: next.round });
    // A new round: the risen undead get up (Nighthawks as Black Slayers) at half Health.
    const risen = synced.fighters.map((f) =>
      f.rising
        ? {
            ...f,
            rising: false,
            health: Math.ceil(f.maxHealth / 2),
            monster: BLACK_SLAYER,
            name: f.monster === BLACK_SLAYER ? f.name : `${f.name} (risen)`,
          }
        : f,
    );
    for (const f of risen) if (synced.fighters.find((o) => o.id === f.id)!.rising) out.push({ type: 'rise', id: f.id });
    if (risen.some((f, k) => f !== synced.fighters[k])) {
      const again = sync(s, risen, next, []);
      list = again.fighters;
      next = again.turn;
    }
  }
  // A held fighter loses its turn; each lost turn wears the hold down by one.
  while (!next.outcome && (list[next.current]!.held ?? 0) > 0) {
    const i = next.current;
    list = list.map((f, k) => (k === i ? { ...f, held: f.held! - 1 } : f));
    out.push({ type: 'held', id: list[i]!.id });
    const round = next.round;
    next = finishTurn(next);
    if (next.round !== round && !next.outcome) out.push({ type: 'round', round: next.round });
  }
  return endTurnTail(s, list, next, out);
}

/** The rest of endTurn once the next combatant is chosen: end-of-fight event, resting cleared, state synced. */
function endTurnTail(s: BattleState, list: Fighter[], next: TurnState, out: BattleEvent[]): BattleState {
  if (next.outcome && !out.some((e) => e.type === 'end')) out.push({ type: 'end', outcome: next.outcome });
  // Resting lasts until the fighter's next turn comes round.
  if (!next.outcome && list[next.current]!.resting)
    list = list.map((f, k) => (k === next.current ? { ...f, resting: false } : f));
  return sync(s, list, next, out);
}

/** Walk to a reachable cell (within Speed steps). The move uses the turn. */
export function moveTo(s: BattleState, target: GridPos): BattleState | undefined {
  if (isOver(s)) return undefined;
  const grid = gridFor(s);
  const i = target.y * grid.cols + target.x;
  if (target.x < 0 || target.y < 0 || target.x >= grid.cols || target.y >= grid.rows || !grid.cells[i]!.reachable)
    return undefined;
  const me = currentFighter(s);
  const path = calculatePath(grid, me.pos, target);
  if (path.length === 0) return undefined;
  const fighters = s.fighters.map((f, k) =>
    k === s.turn.current ? { ...f, pos: target, facing: directionBetween(path[path.length - 2] ?? me.pos, target) } : f,
  );
  return endTurn(s, fighters, [{ type: 'move', id: me.id, from: me.pos, path }]);
}

/**
 * Walk as far as this turn allows towards a place to strike the fighter at `target` from: the end of the path
 * to it, or the furthest reachable cell along the way. Undefined when there is no way there.
 */
export function advanceOn(s: BattleState, target: GridPos): BattleState | undefined {
  if (isOver(s)) return undefined;
  const grid = gridFor(s);
  const me = currentFighter(s);
  const stand = selectAttackPosition(grid, me.pos, target);
  if (!stand || samePos(stand, me.pos)) return undefined;
  const path = calculatePath(grid, me.pos, stand);
  for (let i = path.length - 1; i >= 0; i--) {
    const c = path[i]!;
    if (grid.cells[c.y * grid.cols + c.x]!.reachable) return moveTo(s, c);
  }
  return undefined;
}

export interface AttackOptions {
  kind?: AttackKind;
}

/**
 * Close in on the enemy at `target` (at most Speed steps) and strike it. A slash is a stationary
 * swing that costs the attacker 1 stamina and needs more than 1 left. Returns undefined when the
 * attack is not possible.
 */
export function attack(s: BattleState, target: GridPos, roll: Roll, opts: AttackOptions = {}): BattleState | undefined {
  if (isOver(s)) return undefined;
  const me = currentFighter(s);
  const kind = opts.kind ?? 'thrust';
  if (kind === 'slash' && me.stamina <= 1) return undefined;
  const grid = gridFor(s);
  const plan = planAttack(grid, me.pos, target, { slash: kind === 'slash', maxSteps: me.speed });
  if (!plan) return undefined;
  const victimIndex = s.fighters.findIndex((f) => !gone(f) && samePos(f.pos, target));
  if (victimIndex < 0) return undefined;

  const events: BattleEvent[] = [];
  const fighters = s.fighters.map((f) => ({ ...f }));
  const attacker = fighters[s.turn.current]!;
  const victim = fighters[victimIndex]!;
  if (plan.moves.length > 0) {
    events.push({ type: 'move', id: me.id, from: me.pos, path: plan.moves });
    attacker.pos = plan.moves[plan.moves.length - 1]!;
  }
  attacker.facing = directionBetween(attacker.pos, victim.pos);
  victim.facing = directionBetween(victim.pos, attacker.pos);

  if (kind === 'slash') {
    Object.assign(attacker, applyDamage(attacker, 1));
  }
  // A riposte: this attacker parried the victim's last blow and strikes back into the opening.
  const riposte = attacker.riposte === victim.id;
  const hit = rollToHit(attacker, victim, kind, roll, riposte ? RIPOSTE_BONUS : 0);
  let damage = 0;
  if (hit) {
    const base = meleeDamage(attacker, kind, victim);
    const flags = weaponHitFlags(attacker.weapon, attacker.weapon?.conditionBased === false);
    damage = warded(victim, reduceDamage(riposte ? Math.round(base * RIPOSTE_DAMAGE) : base, victim, roll));
    damage = monsterDamage(victim.monster, flags, damage);
    Object.assign(victim, applyDamage(victim, damage));
    if (damage > 0 && flags & HitFlag.Poison && !resistsPoison(victim.monster) && !victim.armor?.poisoned)
      victim.poisoned = true;
  } else if (victim.defending) victim.riposte = attacker.id;
  if (riposte) attacker.riposte = undefined;
  const killed = isDead(victim);
  const effect = hit ? hitEffect(attacker.weapon, attacker.weapon?.conditionBased === false) : undefined;
  events.push({
    type: 'attack',
    attacker: attacker.id,
    target: victim.id,
    kind,
    hit,
    damage,
    killed,
    ...(effect && { effect }),
  });
  return endTurn(s, fighters, events);
}

/**
 * Fighters a ranged shooter could hit from where it stands: living enemies within range and in plain view. Nobody
 * shoots with an enemy next to them (manual p. 44: at least one step from the nearest opponent).
 */
export function shootTargets(s: BattleState, index = s.turn.current): Fighter[] {
  const me = s.fighters[index]!;
  if (!me.ranged || me.ranged.weapon.condition <= 0 || nextToEnemy(s, index)) return [];
  return s.fighters.filter(
    (f) =>
      f.side !== me.side &&
      !gone(f) &&
      chebyshevDistance(me.pos, f.pos) <= RANGED_RANGE &&
      lineOfSight(s, me.pos, f.pos),
  );
}

/** Fire the crossbow at the enemy on `target` without moving; the shot uses the turn. */
export function shoot(s: BattleState, target: GridPos, roll: Roll): BattleState | undefined {
  if (isOver(s)) return undefined;
  const me = currentFighter(s);
  if (!shootTargets(s).some((f) => samePos(f.pos, target))) return undefined;
  const victimIndex = s.fighters.findIndex((f) => !gone(f) && samePos(f.pos, target));
  const fighters = s.fighters.map((f) => ({ ...f }));
  const shooter = fighters[s.turn.current]!;
  const victim = fighters[victimIndex]!;
  shooter.facing = directionBetween(shooter.pos, victim.pos);
  const distance = chebyshevDistance(shooter.pos, victim.pos);
  const hit = rollToHitRanged(me.ranged!, victim, distance, roll);
  let damage = 0;
  let stray: { target: string; damage: number; killed: boolean } | undefined;
  if (hit) {
    damage = monsterDamage(
      victim.monster,
      weaponHitFlags(me.ranged!.weapon),
      warded(victim, reduceDamage(rangedDamage(me.ranged!), victim, roll)),
    );
    Object.assign(victim, applyDamage(victim, damage));
  } else {
    // An errant bolt can strike whoever stands next to the target, friend or foe (manual p. 50).
    const near = fighters.filter(
      (f) => f !== victim && f !== shooter && !gone(f) && chebyshevDistance(f.pos, victim.pos) === 1,
    );
    if (near.length > 0 && roll(0, 99) < STRAY_CHANCE) {
      const other = near[roll(0, near.length - 1)]!;
      const d = monsterDamage(
        other.monster,
        weaponHitFlags(me.ranged!.weapon),
        warded(other, reduceDamage(rangedDamage(me.ranged!), other, roll)),
      );
      Object.assign(other, applyDamage(other, d));
      stray = { target: other.id, damage: d, killed: isDead(other) };
    }
  }
  const killed = isDead(victim);
  return endTurn(s, fighters, [
    { type: 'shoot', attacker: me.id, target: victim.id, hit, damage, killed, distance, ...(stray && { stray }) },
  ]);
}

/** Spell kinds castable in a fight. */
/** What a combat spell does (see spellKind). */
export type CastKind =
  'damage' | 'heal' | 'hold' | 'ward' | 'drain' | 'push' | 'pull' | 'silence' | 'banish' | 'mirror' | 'summon';
const COMBAT_KINDS: readonly string[] = [
  'damage',
  'heal',
  'hold',
  'ward',
  'drain',
  'push',
  'pull',
  'silence',
  'banish',
  'mirror',
  'summon',
];
/** Kinds aimed at an enemy (the rest at an ally or the caster). */
export const HOSTILE_KINDS: readonly string[] = ['damage', 'hold', 'drain', 'push', 'pull', 'silence', 'banish'];

/**
 * Slide `subject` up to `steps` cells in a straight line away from the caster (push) or towards it (pull),
 * stopping at the grid edge, a blocked cell, or (pulling) next to the caster. Returns the cells moved through.
 */
function slide(s: BattleState, caster: Fighter, subject: Fighter, steps: number, away: boolean): GridPos[] {
  const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
  const k = away ? 1 : -1;
  const dx = sign(subject.pos.x - caster.pos.x) * k;
  const dy = sign(subject.pos.y - caster.pos.y) * k;
  const grid = gridFor(s);
  const path: GridPos[] = [];
  let at = subject.pos;
  for (let i = 0; i < steps; i++) {
    if (!away && chebyshevDistance(at, caster.pos) <= 1) break;
    const next = { x: at.x + dx, y: at.y + dy };
    if (next.x < 0 || next.y < 0 || next.x >= grid.cols || next.y >= grid.rows) break;
    const cell = grid.cells[next.y * grid.cols + next.x]!;
    if (cell.disabled || s.fighters.some((f) => !isDead(f) && samePos(f.pos, next))) break;
    path.push(next);
    at = next;
  }
  return path;
}

/** The other living enemies of the caster an area spell strikes besides `subject` (see SPELL_SPLASH). */
function splashVictims(fighters: readonly Fighter[], caster: Fighter, subject: Fighter, spell: number): Fighter[] {
  const reach = SPELL_SPLASH[spell];
  if (!reach) return [];
  if (reach === 'within2')
    // Flamecast's fire spreads to anyone within two steps of the target: friend or foe, but not the caster.
    return fighters.filter(
      (f) => f !== subject && f !== caster && !gone(f) && chebyshevDistance(subject.pos, f.pos) <= 2,
    );
  const others = fighters.filter((f) => f !== subject && f.side === subject.side && !gone(f));
  if (reach === 'all') return others.filter((f) => chebyshevDistance(caster.pos, f.pos) <= RANGED_RANGE);
  if (reach === 'adjacent') return others.filter((f) => chebyshevDistance(subject.pos, f.pos) === 1);
  return others
    .filter((f) => chebyshevDistance(caster.pos, f.pos) <= RANGED_RANGE)
    .sort((a, b) => chebyshevDistance(subject.pos, a.pos) - chebyshevDistance(subject.pos, b.pos))
    .slice(0, 2);
}

/**
 * Combat spells the current fighter could cast right now (it knows them and can pay the minimum). Nobody casts
 * with an enemy next to them (manual p. 45).
 */
export function castableSpells(s: BattleState, index = s.turn.current): SpellDef[] {
  const me = s.fighters[index]!;
  if (gone(me) || (me.silenced ?? 0) > 0 || nextToEnemy(s, index)) return [];
  return (me.spells ?? []).filter((d) => {
    const kind = spellKind(d);
    return (
      COMBAT_KINDS.includes(kind) && (freeCast(me, d) || me.health + me.stamina >= d.minCost) && carriesFor(me.items, d)
    );
  });
}

/** The Lightning Staff calls lightning (Skyfire) without costing its wielder anything (manual p. 40). */
export function freeCast(f: Fighter, def: SpellDef): boolean {
  return def.index === SKYFIRE && f.weapon?.index === LIGHTNING_STAFF;
}

/** Power a fighter casts `def` at: as much as affordable up to its maximum, keeping 1 point. */
export function castPower(f: Fighter, def: SpellDef): number {
  return maxPower(
    { skills: { health: { trueSkill: f.health }, stamina: { trueSkill: f.stamina } } } as Parameters<
      typeof maxPower
    >[0],
    def,
  );
}

/**
 * Cast a spell on the fighter at `target` without moving; the cast uses the turn. Damage spells
 * need an enemy in range, healing spells a living ally (or the caster); armour does not reduce
 * spell damage. The cost comes off Stamina, then Health (never below 1); `maxSpend` caps the power
 * (the enemy AI uses it to cast from Stamina only).
 */
/** Spells that need a clear line to the target (bolts that travel): damage spells other than Skyfire's lightning. */
export function needsLineOfSight(def: SpellDef): boolean {
  return spellKind(def) === 'damage' && def.index !== SKYFIRE;
}

/** Chance (percent) a line-of-sight spell lands: Casting Accuracy, less 3 per step beyond the first, 5..98. */
export function castHitChance(casting: number, distance: number): number {
  return Math.max(5, Math.min(98, casting - 3 * Math.max(0, distance - 1)));
}

export function castSpell(
  s: BattleState,
  spellIndex: number,
  target: GridPos,
  maxSpend = Infinity,
  roll?: Roll,
): BattleState | undefined {
  if (isOver(s)) return undefined;
  const me = currentFighter(s);
  const def = castableSpells(s).find((d) => d.index === spellIndex);
  if (!def) return undefined;
  const kind = spellKind(def) as CastKind;
  const hostile = HOSTILE_KINDS.includes(kind);
  // Final Rest may also be laid on a fallen Nighthawk or Black Slayer waiting to rise.
  const victimIndex = s.fighters.findIndex(
    (f) => (!gone(f) || (def.index === FINAL_REST && f.rising === true)) && samePos(f.pos, target),
  );
  const victim = s.fighters[victimIndex];
  if (!victim || chebyshevDistance(me.pos, victim.pos) > RANGED_RANGE) return undefined;
  if (hostile !== (victim.side !== me.side)) return undefined;
  if (needsLineOfSight(def) && !lineOfSight(s, me.pos, victim.pos)) return undefined;
  const gift = def.index === GIFT_OF_SUNG && kind === 'heal';
  if (gift && victim.id === me.id) return undefined;

  const free = freeCast(me, def);
  const power = free ? def.maxCost : Math.min(castPower(me, def), maxSpend);
  if (power < def.minCost) return undefined;
  // Gift of Sung transfers the power spent one for one; the Infinity Pool magnifies its bearer's spells.
  const pooled = (me.items ?? []).includes(INFINITY_POOL);
  const base = gift ? power : spellAmount(def, power);
  const amount =
    pooled && kind !== 'summon' && kind !== 'banish' && kind !== 'mirror'
      ? Math.round(base * INFINITY_POOL_BONUS)
      : base;
  const fighters = s.fighters.map((f) => ({ ...f }));
  const caster = fighters[s.turn.current]!;
  const aimed = fighters[victimIndex]!;
  // Mirror Wall: a hostile spell aimed at a warded fighter strikes its caster instead.
  const reflected = hostile && aimed.mirror ? aimed.id : undefined;
  const subject = reflected ? caster : aimed;
  caster.facing = directionBetween(caster.pos, aimed.pos);
  if (!free) {
    const paid = applyDamage(caster, power);
    caster.stamina = paid.stamina;
    caster.health = Math.max(1, paid.health);
  }
  let also: { target: string; amount: number; killed: boolean }[] | undefined;
  let moved = 0;
  let turn = s.turn;
  let summoned: string | undefined;
  let effect = amount;
  // A bolt can miss: Casting Accuracy against the distance (the cost is paid either way).
  const missed =
    !!roll &&
    needsLineOfSight(def) &&
    me.casting !== undefined &&
    roll(0, 99) >= castHitChance(me.casting, chebyshevDistance(me.pos, victim.pos));
  if (missed) effect = 0;
  else if (kind === 'damage') {
    // Skyfire only strikes a fighter carrying metal (a weapon or armour).
    if (def.index === SKYFIRE && !subject.weapon && !subject.armor) effect = 0;
    Object.assign(subject, applyDamage(subject, warded(subject, effect)));
    const splash = reflected ? [] : splashVictims(fighters, caster, subject, def.index);
    if (splash.length > 0)
      also = splash.map((f) => {
        Object.assign(f, applyDamage(f, warded(f, amount)));
        return { target: f.id, amount, killed: isDead(f) };
      });
  } else if (kind === 'drain') {
    const before = subject.health;
    Object.assign(subject, applyDamage(subject, warded(subject, amount)));
    caster.health = Math.min(caster.maxHealth, caster.health + Math.max(0, before - subject.health));
  } else if (kind === 'push' || kind === 'pull') {
    const path = slide(s, caster, subject, amount, kind === 'push');
    if (path.length > 0) subject.pos = path[path.length - 1]!;
    moved = path.length;
  } else if (kind === 'silence') subject.silenced = Math.max(subject.silenced ?? 0, amount);
  else if (kind === 'mirror') subject.mirror = true;
  else if (kind === 'summon') {
    // The newcomer stands next to the chosen ally and acts from the next round.
    const at = freeCellNear(s, subject.pos);
    effect = at ? 1 : 0;
    if (at) {
      const f = summonedFighter(s, caster, def.index, power, at);
      fighters.push(f);
      turn = {
        ...s.turn,
        combatants: [
          ...s.turn.combatants,
          { ...newCombatant(f.id, f.side, f.speed, f.health), turnPending: false, summoned: true },
        ],
      };
      summoned = f.id;
    }
  } else if (kind === 'banish') {
    const rule = BANISHES[def.index]!;
    effect = rule.monsters.includes(subject.monster) ? 1 : 0;
    if (effect) {
      subject.health = 0;
      if (rule.effect === 'drive off') subject.banished = true;
      // Laid to rest for good: Lims-Kragma takes it, and it will not rise again.
      if (def.index === FINAL_REST) {
        subject.rising = false;
        subject.laidToRest = true;
      }
    }
  } else if (kind === 'hold') {
    // Grief works only on a mind that can grieve.
    if (def.index === GRIEF && MINDLESS_MONSTERS.has(subject.monster) && subject.side === 'enemy') effect = 0;
    else subject.held = Math.max(subject.held ?? 0, amount);
  } else if (kind === 'ward') subject.ward = Math.max(subject.ward ?? 0, amount);
  else subject.health = Math.min(subject.maxHealth, subject.health + amount);
  const killed = (kind === 'damage' || kind === 'drain' || (kind === 'banish' && !subject.banished)) && isDead(subject);
  return endTurn(
    s,
    fighters,
    [
      {
        type: 'cast',
        caster: me.id,
        target: subject.id,
        spell: def.name,
        power,
        kind,
        amount:
          kind === 'push' || kind === 'pull'
            ? moved
            : kind === 'damage' || kind === 'banish' || kind === 'summon' || kind === 'hold'
              ? effect
              : amount,
        killed,
        ...(also && { also }),
        ...(reflected && { reflected }),
        ...(summoned && { summoned }),
        ...(missed && { missed }),
      },
    ],
    turn,
  );
}

/** Defending ends the turn; attackers add 20 to their hit roll against the defender until the next round. */
export function defend(s: BattleState): BattleState | undefined {
  if (isOver(s)) return undefined;
  const marked: TurnState = {
    ...s.turn,
    combatants: s.turn.combatants.map((c, i) => (i === s.turn.current ? { ...c, defending: true } : c)),
  };
  return endTurn(s, s.fighters, [{ type: 'defend', id: currentFighter(s).id }], marked);
}

/** Share of Health plus Stamina a turn of rest restores (Health first, then Stamina). */
export const REST_SHARE = 0.1;

/**
 * Rest (manual p. 46): regain some Health and Stamina, but stand easier to hit until your next turn.
 * Restores Health first, then Stamina, as healing does.
 */
export function rest(s: BattleState): BattleState | undefined {
  if (isOver(s)) return undefined;
  const i = s.turn.current;
  const me = s.fighters[i]!;
  let gain = Math.max(1, Math.round((me.maxHealth + me.maxStamina) * REST_SHARE));
  const health = Math.min(me.maxHealth, me.health + gain);
  gain -= health - me.health;
  const stamina = Math.min(me.maxStamina, me.stamina + Math.max(0, gain));
  const healed = health - me.health + (stamina - me.stamina);
  const fighters = s.fighters.map((f, k) => (k === i ? { ...f, health, stamina, resting: true } : f));
  return endTurn(s, fighters, [{ type: 'rest', id: me.id, healed }]);
}

/**
 * Size up an enemy (manual pp. 28, 46): uses the turn; the higher the Assessment skill, the more it reveals,
 * starting with how hurt it is.
 */
export function assess(s: BattleState, target: GridPos): BattleState | undefined {
  if (isOver(s)) return undefined;
  const me = currentFighter(s);
  const foe = s.fighters.find((f) => !gone(f) && f.side !== me.side && samePos(f.pos, target));
  if (!foe) return undefined;
  const facts = assessFacts(foe, me.assessment ?? 30);
  return endTurn(s, s.fighters, [{ type: 'assess', id: me.id, target: foe.id, facts }]);
}

/** What an Assessment skill of `skill` reveals about `f`: one fact per 20 points, at least one, at most six. */
export function assessFacts(f: Fighter, skill: number): string[] {
  const all = [
    `Health ${f.health} of ${f.maxHealth}`,
    `Stamina ${f.stamina} of ${f.maxStamina}`,
    f.speed >= 6 ? `very quick (Speed ${f.speed})` : f.speed <= 3 ? `slow (Speed ${f.speed})` : `Speed ${f.speed}`,
    `Strength ${f.strength}`,
    `Defense ${f.defense}%, Melee ${f.melee}%`,
    f.spells && f.spells.length > 0
      ? `a spellcaster`
      : f.ranged
        ? `carries a crossbow`
        : f.armor
          ? `wears armour`
          : `no armour, no spells`,
  ];
  return all.slice(0, Math.max(1, Math.min(all.length, Math.floor(skill / 20))));
}

/** Percent chance a retreat works: 70, less 10 for each enemy standing next to a party member, at least 25. */
export function retreatChance(s: BattleState): number {
  const party = s.fighters.filter((f) => f.side === 'party' && !gone(f));
  const pressing = s.fighters.filter(
    (f) => f.side === 'enemy' && !gone(f) && party.some((p) => chebyshevDistance(p.pos, f.pos) <= 1),
  ).length;
  return Math.max(25, 70 - 10 * pressing);
}

/**
 * The party tries to retreat (manual p. 46). It refuses while any member is down; otherwise it gets away on a
 * `retreatChance` roll. Success or not, the attempt uses the turn. Without a `roll` it always works (tests).
 */
export function flee(s: BattleState, roll?: Roll): BattleState | undefined {
  if (isOver(s) || currentFighter(s).side !== 'party') return undefined;
  if (!canFlee(s.turn.combatants)) return endTurn(s, s.fighters, [{ type: 'flee', success: false, refused: true }]);
  const success = !roll || roll(0, 99) < retreatChance(s);
  if (!success) return endTurn(s, s.fighters, [{ type: 'flee', success: false }]);
  const turn: TurnState = { ...s.turn, outcome: 'fled' };
  const events: BattleEvent[] = [
    { type: 'flee', success },
    { type: 'end', outcome: 'fled' },
  ];
  return { ...s, turn, events, history: [...s.history, ...events] };
}

/** An enemy runs from the fight (morale, see ai.ts): it leaves the field alive, taking its gear with it. */
export function enemyRetreat(s: BattleState): BattleState | undefined {
  if (isOver(s)) return undefined;
  const i = s.turn.current;
  const me = s.fighters[i]!;
  if (me.side !== 'enemy') return undefined;
  const fighters = s.fighters.map((f, k) => (k === i ? { ...f, fled: true } : f));
  const turn: TurnState = {
    ...s.turn,
    combatants: s.turn.combatants.map((c, k) => (k === i ? { ...c, fled: true } : c)),
  };
  return endTurn(s, fighters, [{ type: 'retreat', id: me.id }], turn);
}

/** Plain-text line for the combat log. */
export function describeEvent(s: BattleState, e: BattleEvent): string {
  const name = (id: string) => s.fighters.find((f) => f.id === id)?.name ?? id;
  switch (e.type) {
    case 'move':
      return `${name(e.id)} moves.`;
    case 'attack': {
      const verb = e.kind === 'slash' ? 'slashes at' : 'strikes at';
      if (!e.hit) return `${name(e.attacker)} ${verb} ${name(e.target)} and misses.`;
      return `${name(e.attacker)} ${verb} ${name(e.target)} for ${e.damage}${e.killed ? ' and fells them' : ''}.`;
    }
    case 'shoot':
      if (!e.hit && e.stray)
        return `${name(e.attacker)} fires at ${name(e.target)} and misses; the bolt strikes ${name(e.stray.target)} for ${e.stray.damage}${e.stray.killed ? ' and fells them' : ''}.`;
      if (!e.hit) return `${name(e.attacker)} fires at ${name(e.target)} and misses.`;
      return `${name(e.attacker)} shoots ${name(e.target)} for ${e.damage}${e.killed ? ' and fells them' : ''}.`;
    case 'cast':
      if (e.missed) return `${name(e.caster)} casts ${e.spell} at ${name(e.target)}, but it goes wide.`;
      if (e.reflected) {
        const hurt =
          e.kind === 'damage' || e.kind === 'drain' ? ` for ${e.amount}${e.killed ? ', felling them' : ''}` : '';
        return `${name(e.caster)} casts ${e.spell} at ${name(e.reflected)}, but a Mirror Wall turns it back on ${name(e.caster)}${hurt}.`;
      }
      switch (e.kind) {
        case 'silence':
          return `${name(e.caster)} casts ${e.spell}; ${name(e.target)} cannot cast for ${e.amount} ${e.amount === 1 ? 'turn' : 'turns'}.`;
        case 'summon':
          return e.summoned
            ? `${name(e.caster)} casts ${e.spell}; ${name(e.summoned)} joins the fight.`
            : `${name(e.caster)} casts ${e.spell}, but there is no room beside ${name(e.target)}.`;
        case 'mirror':
          return `${name(e.caster)} casts ${e.spell}; a Mirror Wall shields ${name(e.target)} from spells.`;
        case 'banish':
          if (e.amount === 0) return `${name(e.caster)} casts ${e.spell}, but it has no power over ${name(e.target)}.`;
          return e.killed
            ? `${name(e.caster)} casts ${e.spell}; ${name(e.target)} is laid to rest.`
            : `${name(e.caster)} casts ${e.spell}; ${name(e.target)} flees the fight.`;
        case 'heal':
          return `${name(e.caster)} casts ${e.spell}; ${name(e.target)} regains ${e.amount}.`;
        case 'hold':
          if (e.amount === 0)
            return `${name(e.caster)} casts ${e.spell}, but ${name(e.target)} has no mind for it to touch.`;
          return `${name(e.caster)} casts ${e.spell}; ${name(e.target)} is held for ${e.amount} ${e.amount === 1 ? 'turn' : 'turns'}.`;
        case 'ward':
          return `${name(e.caster)} casts ${e.spell}; ${name(e.target)} is shielded (${e.amount}).`;
        case 'push':
        case 'pull':
          return e.amount === 0
            ? `${name(e.caster)} casts ${e.spell}, but ${name(e.target)} cannot move.`
            : `${name(e.caster)} casts ${e.spell}; ${name(e.target)} is ${e.kind === 'push' ? 'thrown back' : 'drawn in'} ${e.amount} ${e.amount === 1 ? 'cell' : 'cells'}.`;
        case 'drain':
          return `${name(e.caster)} casts ${e.spell}, draining ${name(e.target)} of ${e.amount}${e.killed ? ' and felling them' : ''}.`;
        default: {
          if (e.amount === 0 && !e.also)
            return `${name(e.caster)} casts ${e.spell}, but ${name(e.target)} carries no metal for it to strike.`;
          const hit = (t: string, killed: boolean) => `${name(t)}${killed ? ' (felled)' : ''}`;
          const others = (e.also ?? []).map((a) => hit(a.target, a.killed));
          if (others.length === 0)
            return `${name(e.caster)} casts ${e.spell} on ${name(e.target)} for ${e.amount}${e.killed ? ' and fells them' : ''}.`;
          return `${name(e.caster)} casts ${e.spell} for ${e.amount} on ${[hit(e.target, e.killed), ...others].join(', ')}.`;
        }
      }
    case 'defend':
      return `${name(e.id)} defends.`;
    case 'rest':
      return e.healed > 0 ? `${name(e.id)} rests and recovers ${e.healed}.` : `${name(e.id)} rests.`;
    case 'assess':
      return `${name(e.id)} sizes up ${name(e.target)}: ${e.facts.join('; ')}.`;
    case 'retreat':
      return `${name(e.id)} breaks and runs.`;
    case 'rise':
      return `${name(e.id)} rises again as a Black Slayer!`;
    case 'poison':
      return `The poison saps ${name(e.id)} (${e.damage})${e.killed ? ', who falls' : ''}.`;
    case 'held':
      return `${name(e.id)} cannot act.`;
    case 'flee':
      return e.success
        ? 'The party retreats.'
        : e.refused
          ? 'The party will not leave a fallen companion behind.'
          : 'The party tries to retreat but cannot break away.';
    case 'round':
      return `Round ${e.round}.`;
    case 'end':
      return e.outcome === 'won' ? 'Victory!' : e.outcome === 'fled' ? 'You got away.' : 'The party has fallen.';
  }
}
