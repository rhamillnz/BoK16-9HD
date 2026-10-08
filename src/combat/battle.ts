/**
 * One fight on the combat grid: fighters, whose turn it is, and the actions a turn can take
 * (move, melee attack, defend, rest, flee). Pure state transitions over `BattleState`; the grid
 * and turn rules live in grid.ts and turns.ts, the melee maths in rules.ts. See docs/formats/combat.md.
 */

import type { SpellDef } from '../formats/spells';
import { maxPower, spellAmount, spellKind } from '../game/spells';
import {
  buildGrid,
  chebyshevDistance,
  calculatePath,
  directionBetween,
  planAttack,
  samePos,
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
} from './rules';
import { beginCombat, finishTurn, flee as fleeTurn, newCombatant, type CombatOutcome, type TurnState } from './turns';

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
    }
  | { type: 'shoot'; attacker: string; target: string; hit: boolean; damage: number; killed: boolean; distance: number }
  | {
      type: 'cast';
      caster: string;
      target: string;
      spell: string;
      power: number;
      kind: 'damage' | 'heal';
      amount: number;
      killed: boolean;
    }
  | { type: 'defend'; id: string }
  | { type: 'rest'; id: string }
  | { type: 'flee'; success: boolean }
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

/** Starts a fight: the fastest party member goes first. */
export function startBattle(fighters: readonly Fighter[], disabled: readonly GridPos[] = []): BattleState {
  const list = fighters.map((f) => ({ ...f }));
  const turn = beginCombat(list.map((f) => ({ ...newCombatant(f.id, f.side, f.speed, f.health), dead: isDead(f) })));
  return { fighters: list, turn, disabled: [...disabled], events: [], history: [] };
}

export const currentIndex = (s: BattleState): number => s.turn.current;
export const currentFighter = (s: BattleState): Fighter => s.fighters[s.turn.current]!;
export const isOver = (s: BattleState): boolean => s.turn.outcome !== undefined;

export function fighterAt(s: BattleState, p: GridPos): Fighter | undefined {
  return s.fighters.find((f) => !isDead(f) && samePos(f.pos, p));
}

/** Cell flags for the current fighter's turn. */
export function gridFor(s: BattleState, index = s.turn.current): CombatGrid {
  const me = s.fighters[index]!;
  return buildGrid({
    disabled: s.disabled,
    occupants: s.fighters.map((f) => ({ id: f.id, pos: f.pos, side: f.side, dead: isDead(f) })),
    mover: { id: me.id, side: me.side, speed: me.speed },
  });
}

/** Copies fighter vitals into the turn state and the turn state's defending flag back to the fighters. */
function sync(s: BattleState, fighters: Fighter[], turn: TurnState, events: BattleEvent[]): BattleState {
  const combatants = turn.combatants.map((c, i) => ({ ...c, dead: isDead(fighters[i]!), health: fighters[i]!.health }));
  const synced = fighters.map((f, i) =>
    f.defending === combatants[i]!.defending ? f : { ...f, defending: combatants[i]!.defending },
  );
  return { ...s, fighters: synced, turn: { ...turn, combatants }, events, history: [...s.history, ...events] };
}

/** Ends the current turn, reporting a new round or the end of the fight. */
function endTurn(s: BattleState, fighters: Fighter[], events: BattleEvent[], turn: TurnState = s.turn): BattleState {
  const synced = sync(s, fighters, turn, events);
  const before = synced.turn.round;
  const next = finishTurn(synced.turn);
  const out = [...events];
  if (next.outcome) out.push({ type: 'end', outcome: next.outcome });
  else if (next.round !== before) out.push({ type: 'round', round: next.round });
  return sync(s, synced.fighters, next, out);
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
  const victimIndex = s.fighters.findIndex((f) => !isDead(f) && samePos(f.pos, target));
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
  const hit = rollToHit(attacker, victim, kind, roll);
  let damage = 0;
  if (hit) {
    damage = reduceDamage(meleeDamage(attacker, kind, victim), victim, roll);
    Object.assign(victim, applyDamage(victim, damage));
  }
  const killed = isDead(victim);
  events.push({ type: 'attack', attacker: attacker.id, target: victim.id, kind, hit, damage, killed });
  return endTurn(s, fighters, events);
}

/** Fighters a ranged shooter could hit from where it stands: living enemies within range. */
export function shootTargets(s: BattleState, index = s.turn.current): Fighter[] {
  const me = s.fighters[index]!;
  if (!me.ranged || me.ranged.weapon.condition <= 0) return [];
  return s.fighters.filter((f) => f.side !== me.side && !isDead(f) && chebyshevDistance(me.pos, f.pos) <= RANGED_RANGE);
}

/** Fire the crossbow at the enemy on `target` without moving; the shot uses the turn. */
export function shoot(s: BattleState, target: GridPos, roll: Roll): BattleState | undefined {
  if (isOver(s)) return undefined;
  const me = currentFighter(s);
  if (!shootTargets(s).some((f) => samePos(f.pos, target))) return undefined;
  const victimIndex = s.fighters.findIndex((f) => !isDead(f) && samePos(f.pos, target));
  const fighters = s.fighters.map((f) => ({ ...f }));
  const shooter = fighters[s.turn.current]!;
  const victim = fighters[victimIndex]!;
  shooter.facing = directionBetween(shooter.pos, victim.pos);
  const distance = chebyshevDistance(shooter.pos, victim.pos);
  const hit = rollToHitRanged(me.ranged!, victim, distance, roll);
  let damage = 0;
  if (hit) {
    damage = reduceDamage(rangedDamage(me.ranged!), victim, roll);
    Object.assign(victim, applyDamage(victim, damage));
  }
  const killed = isDead(victim);
  return endTurn(s, fighters, [{ type: 'shoot', attacker: me.id, target: victim.id, hit, damage, killed, distance }]);
}

/** Combat spells the current fighter could cast right now (it knows them and can pay the minimum). */
export function castableSpells(s: BattleState, index = s.turn.current): SpellDef[] {
  const me = s.fighters[index]!;
  if (isDead(me)) return [];
  return (me.spells ?? []).filter((d) => {
    const kind = spellKind(d);
    return (kind === 'damage' || kind === 'heal') && me.health + me.stamina >= d.minCost;
  });
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
export function castSpell(
  s: BattleState,
  spellIndex: number,
  target: GridPos,
  maxSpend = Infinity,
): BattleState | undefined {
  if (isOver(s)) return undefined;
  const me = currentFighter(s);
  const def = castableSpells(s).find((d) => d.index === spellIndex);
  if (!def) return undefined;
  const kind = spellKind(def) as 'damage' | 'heal';
  const victimIndex = s.fighters.findIndex((f) => !isDead(f) && samePos(f.pos, target));
  const victim = s.fighters[victimIndex];
  if (!victim || chebyshevDistance(me.pos, victim.pos) > RANGED_RANGE) return undefined;
  if ((kind === 'damage') !== (victim.side !== me.side)) return undefined;

  const power = Math.min(castPower(me, def), maxSpend);
  if (power < def.minCost) return undefined;
  const amount = spellAmount(def, power);
  const fighters = s.fighters.map((f) => ({ ...f }));
  const caster = fighters[s.turn.current]!;
  const subject = fighters[victimIndex]!;
  caster.facing = directionBetween(caster.pos, subject.pos);
  const paid = applyDamage(caster, power);
  caster.stamina = paid.stamina;
  caster.health = Math.max(1, paid.health);
  if (kind === 'damage') Object.assign(subject, applyDamage(subject, amount));
  else subject.health = Math.min(subject.maxHealth, subject.health + amount);
  const killed = kind === 'damage' && isDead(subject);
  return endTurn(s, fighters, [
    { type: 'cast', caster: me.id, target: subject.id, spell: def.name, power, kind, amount, killed },
  ]);
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

/** Skip the turn. */
export function rest(s: BattleState): BattleState | undefined {
  if (isOver(s)) return undefined;
  return endTurn(s, s.fighters, [{ type: 'rest', id: currentFighter(s).id }]);
}

/** The party retreats unless more than one of its members is dead (BaKGL always succeeds otherwise). */
export function flee(s: BattleState): BattleState | undefined {
  if (isOver(s) || currentFighter(s).side !== 'party') return undefined;
  const turn = fleeTurn(s.turn);
  const success = turn.outcome === 'fled';
  const events: BattleEvent[] = [{ type: 'flee', success }];
  if (success) events.push({ type: 'end', outcome: 'fled' });
  return { ...s, turn, events, history: [...s.history, ...events] };
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
      if (!e.hit) return `${name(e.attacker)} fires at ${name(e.target)} and misses.`;
      return `${name(e.attacker)} shoots ${name(e.target)} for ${e.damage}${e.killed ? ' and fells them' : ''}.`;
    case 'cast':
      return e.kind === 'heal'
        ? `${name(e.caster)} casts ${e.spell}; ${name(e.target)} regains ${e.amount}.`
        : `${name(e.caster)} casts ${e.spell} on ${name(e.target)} for ${e.amount}${e.killed ? ' and fells them' : ''}.`;
    case 'defend':
      return `${name(e.id)} defends.`;
    case 'rest':
      return `${name(e.id)} waits.`;
    case 'flee':
      return e.success ? 'The party retreats.' : 'The party cannot retreat.';
    case 'round':
      return `Round ${e.round}.`;
    case 'end':
      return e.outcome === 'won' ? 'Victory!' : e.outcome === 'fled' ? 'You got away.' : 'The party has fallen.';
  }
}
