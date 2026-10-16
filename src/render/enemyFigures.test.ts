import { describe, expect, it } from 'vitest';
import { facingAngle, PATROL_REACH, PATROL_SPEED, patrolOffset, spawnPoint } from './enemyFigures';

describe('enemies in the world before a fight', () => {
  it('stand where DEF_COMB places them, relative to the encounter tile', () => {
    // Combat 1: a moredhel warrior in tile 10,14 at (42184, 11098), facing west.
    expect(spawnPoint({ tileX: 10, tileY: 14 }, { x: 42184, y: 11098, heading: 64 })).toEqual({
      x: 682184,
      y: 907098,
      heading: 64,
    });
  });

  it('pace out and back along their line', () => {
    const period = (4 * PATROL_REACH) / PATROL_SPEED;
    expect(patrolOffset(0).along).toBeCloseTo(0);
    expect(patrolOffset(period / 4).along).toBeCloseTo(PATROL_REACH);
    expect(patrolOffset(period / 2).along).toBeCloseTo(0);
    expect(patrolOffset((3 * period) / 4).along).toBeCloseTo(-PATROL_REACH);
    expect(patrolOffset(period / 8).direction).toBe(1);
    expect(patrolOffset(period / 2).direction).toBe(-1);
  });

  it('face the way they go (models face +Z, render z = -y)', () => {
    expect(facingAngle(0, -1)).toBeCloseTo(0); // south
    expect(facingAngle(1, 0)).toBeCloseTo(Math.PI / 2); // east
  });
});
