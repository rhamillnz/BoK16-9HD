/**
 * Enemy turns. BaKGL's combat AI is not part of what we have read, so this is a simple stand-in:
 * strike the nearest party member if one can be reached this turn, otherwise step toward the
 * nearest one, otherwise wait.
 */

import { attack, currentFighter, gridFor, isOver, moveTo, rest, type BattleState } from './battle';
import { isDead, type Roll } from './rules';
import type { GridPos } from './grid';

const manhattan = (a: GridPos, b: GridPos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function enemyTurn(s: BattleState, roll: Roll): BattleState {
  if (isOver(s)) return s;
  const me = currentFighter(s);
  const foes = s.fighters.filter((f) => f.side !== me.side && !isDead(f)).sort((a, b) => manhattan(me.pos, a.pos) - manhattan(me.pos, b.pos));
  for (const foe of foes) {
    const next = attack(s, foe.pos, roll);
    if (next) return next;
  }
  const target = foes[0];
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
