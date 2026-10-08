/**
 * Enemy turns. BaKGL's combat AI is not part of what we have read, so this is our own stand-in
 * (**unverified**), in priority order:
 *  1. badly hurt (a quarter of Health or less) with a foe next to it: defend;
 *  2. a caster with Stamina to spend: heal an ally at half Health or less, else cast the strongest
 *     damage spell it can pay for from Stamina alone at the weakest foe in range (never at the
 *     cost of its own Health);
 *  3. a shooter with no foe next to it: shoot the weakest foe in range;
 *  4. strike the weakest foe it can reach this turn, slashing when it has stamina to spare;
 *  5. shoot if it can; otherwise step toward the nearest foe; otherwise wait.
 */

import {
  attack,
  castableSpells,
  castPower,
  castSpell,
  currentFighter,
  defend,
  gridFor,
  isOver,
  moveTo,
  rest,
  shoot,
  shootTargets,
  type BattleState,
  type Fighter,
} from './battle';
import { isDead, RANGED_RANGE, type Roll } from './rules';
import { spellAmount, spellKind } from '../game/spells';
import { isAdjacent, type GridPos } from './grid';

const manhattan = (a: GridPos, b: GridPos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** Fraction of Health at or below which a fighter turtles up. */
export const WOUNDED_FRACTION = 0.25;

const toughness = (f: Fighter) => f.health + f.stamina;

export function enemyTurn(s: BattleState, roll: Roll): BattleState {
  if (isOver(s)) return s;
  const me = currentFighter(s);
  const foes = s.fighters.filter((f) => f.side !== me.side && !isDead(f));
  const nearest = [...foes].sort((a, b) => manhattan(me.pos, a.pos) - manhattan(me.pos, b.pos));
  const weakest = [...foes].sort(
    (a, b) => toughness(a) - toughness(b) || manhattan(me.pos, a.pos) - manhattan(me.pos, b.pos),
  );
  const touching = foes.some((f) => isAdjacent(me.pos, f.pos));

  if (touching && me.maxHealth > 0 && me.health <= me.maxHealth * WOUNDED_FRACTION) {
    const next = defend(s);
    if (next) return next;
  }

  const cast = castTurn(s);
  if (cast) return cast;

  const shootWeakest = (): BattleState | undefined => {
    const targets = shootTargets(s).sort((a, b) => toughness(a) - toughness(b));
    return targets[0] ? shoot(s, targets[0].pos, roll) : undefined;
  };
  if (me.ranged && !touching) {
    const next = shootWeakest();
    if (next) return next;
  }

  for (const foe of weakest) {
    const slash = isAdjacent(me.pos, foe.pos) && me.stamina > Math.max(3, me.maxStamina / 2);
    const next = (slash ? attack(s, foe.pos, roll, { kind: 'slash' }) : undefined) ?? attack(s, foe.pos, roll);
    if (next) return next;
  }
  const shot = shootWeakest();
  if (shot) return shot;

  const target = nearest[0];
  if (target) {
    const grid = gridFor(s);
    let best: GridPos | undefined;
    let bestDist = manhattan(me.pos, target.pos);
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.cols; x++) {
        if (!grid.cells[y * grid.cols + x]!.reachable) continue;
        const d = manhattan({ x, y }, target.pos);
        if (d < bestDist) {
          bestDist = d;
          best = { x, y };
        }
      }
    }
    if (best) {
      const next = moveTo(s, best);
      if (next) return next;
    }
  }
  return rest(s) ?? s;
}

/** Fraction of Health at or below which a caster heals an ally. */
export const HEAL_BELOW = 0.5;

/** A spell turn for the current fighter, or undefined when it has no worthwhile cast. */
function castTurn(s: BattleState): BattleState | undefined {
  const me = currentFighter(s);
  const spells = castableSpells(s).filter((d) => d.minCost <= me.stamina);
  if (spells.length === 0) return undefined;
  const power = (d: (typeof spells)[number]) => Math.min(castPower(me, d), me.stamina);
  const inRange = (f: Fighter) => Math.max(Math.abs(f.pos.x - me.pos.x), Math.abs(f.pos.y - me.pos.y)) <= RANGED_RANGE;
  const strongest = (kind: string) =>
    spells.filter((d) => spellKind(d) === kind).sort((a, b) => spellAmount(b, power(b)) - spellAmount(a, power(a)))[0];

  const hurt = s.fighters
    .filter((f) => f.side === me.side && !isDead(f) && inRange(f) && f.health <= f.maxHealth * HEAL_BELOW)
    .sort((a, b) => a.health / a.maxHealth - b.health / b.maxHealth)[0];
  const heal = strongest('heal');
  if (hurt && heal) {
    const next = castSpell(s, heal.index, hurt.pos, me.stamina);
    if (next) return next;
  }

  const foe = s.fighters
    .filter((f) => f.side !== me.side && !isDead(f) && inRange(f))
    .sort((a, b) => toughness(a) - toughness(b))[0];
  const harm = strongest('damage');
  return foe && harm ? castSpell(s, harm.index, foe.pos, me.stamina) : undefined;
}
