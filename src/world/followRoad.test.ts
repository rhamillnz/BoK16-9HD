import { describe, expect, it } from 'vitest';
import { followRoad, onRoadCentre, roadRun, waysOn, type RoadMask } from './followRoad';

/** A road 400 units wide along the y axis (north), from y = 0 to y = 5000. */
const straight: RoadMask = { get: (x, y) => Math.abs(x) <= 200 && y >= 0 && y <= 5000 };
/** That road, splitting at y = 2000 into a branch north-east and one north-west. */
const forked: RoadMask = {
  get: (x, y) =>
    (Math.abs(x) <= 200 && y >= 0 && y <= 2000) ||
    (y > 1800 && Math.abs(x - (y - 2000)) <= 200) ||
    (y > 1800 && Math.abs(x + (y - 2000)) <= 200),
};

describe('follow road (manual p. 16)', () => {
  it('measures how far the road runs ahead', () => {
    expect(roadRun(straight, 0, 1000, 0)).toBe(1200);
    expect(roadRun(straight, 0, 4500, 0)).toBe(500);
    expect(roadRun(straight, 0, 1000, 64)).toBe(200);
  });

  it('only switches on in the middle of the road', () => {
    expect(onRoadCentre(straight, 0, 1000, 0)).toBe(true);
    expect(onRoadCentre(straight, 180, 1000, 0)).toBe(false);
    expect(onRoadCentre(straight, 900, 1000, 0)).toBe(false);
  });

  it('turns the party along the road when it faces a little off it', () => {
    const step = followRoad(straight, 0, 1000, 10);
    expect(step.kind).toBe('steer');
    const h = (step as { heading: number }).heading;
    expect(Math.min(h, 256 - h)).toBeLessThan(6);
  });

  it('stops at a fork until the party picks a branch, and at the road end', () => {
    expect(waysOn(forked, 0, 1900, 0)).toHaveLength(2);
    expect(followRoad(forked, 0, 1900, 0)).toEqual({ kind: 'fork' });
    const picked = followRoad(forked, 0, 1900, 224, true);
    expect(picked.kind).toBe('steer');
    expect(followRoad(straight, 0, 4900, 0)).toEqual({ kind: 'end' });
  });
});
