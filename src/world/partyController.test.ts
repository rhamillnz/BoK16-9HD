import { describe, expect, it } from 'vitest';
import type { CollisionPolygon } from './collision';
import {
  EYE_HEIGHT,
  NO_INPUT,
  PARTY_RADIUS,
  PartyController,
  RUN_MULTIPLIER,
  TURN_RATE,
  WALK_SPEED,
  headingToVector,
  normalizeHeading,
  stepHeading,
  walkDelta,
} from './partyController';

const wall: CollisionPolygon = { points: [-500, 1000, 500, 1000, 500, 1100, -500, 1100], minX: -500, minY: 1000, maxX: 500, maxY: 1100 };

describe('heading maths', () => {
  it('wraps into [0, 256)', () => {
    expect(normalizeHeading(256)).toBe(0);
    expect(normalizeHeading(-1)).toBe(255);
    expect(normalizeHeading(300)).toBe(44);
  });

  it('maps headings to compass directions (0 N, 64 W, 128 S, 192 E)', () => {
    const near = (h: number, x: number, y: number) => {
      const v = headingToVector(h);
      expect(v.x).toBeCloseTo(x, 9);
      expect(v.y).toBeCloseTo(y, 9);
    };
    near(0, 0, 1);
    near(64, -1, 0);
    near(128, 0, -1);
    near(192, 1, 0);
  });

  it('turning left increases heading and wraps', () => {
    expect(stepHeading(0, 1, 1)).toBeCloseTo(TURN_RATE);
    expect(stepHeading(0, -1, 1)).toBeCloseTo(256 - TURN_RATE);
    expect(stepHeading(10, 0, 1)).toBe(10);
  });

  it('walk delta scales with speed, run and direction', () => {
    expect(walkDelta(0, 1, false, 1).y).toBeCloseTo(WALK_SPEED);
    expect(walkDelta(0, 1, true, 1).y).toBeCloseTo(WALK_SPEED * RUN_MULTIPLIER);
    expect(walkDelta(0, -1, false, 1).y).toBeCloseTo(-WALK_SPEED);
    expect(walkDelta(192, 1, false, 0.5).x).toBeCloseTo(WALK_SPEED / 2);
    const idle = walkDelta(0, 0, true, 1);
    expect(Math.abs(idle.x) + Math.abs(idle.y)).toBe(0);
  });
});

describe('PartyController', () => {
  it('walks north, strafes nothing, and runs faster', () => {
    const p = new PartyController();
    p.update(1, { ...NO_INPUT, forward: true });
    expect(p.y).toBeCloseTo(WALK_SPEED);
    expect(p.x).toBeCloseTo(0);
    p.update(1, { ...NO_INPUT, forward: true, run: true });
    expect(p.y).toBeCloseTo(WALK_SPEED * 3);
  });

  it('opposing keys cancel', () => {
    const p = new PartyController(5, 5, 10);
    p.update(1, { ...NO_INPUT, forward: true, back: true, turnLeft: true, turnRight: true });
    expect([p.x, p.y, p.heading]).toEqual([5, 5, 10]);
  });

  it('moves along the turned heading', () => {
    const p = new PartyController(0, 0, 64);
    p.update(1, { ...NO_INPUT, forward: true });
    expect(p.x).toBeCloseTo(-WALK_SPEED);
    expect(p.y).toBeCloseTo(0);
  });

  it('exposes an 8-bit heading', () => {
    const p = new PartyController(0, 0, 255.9);
    expect(p.heading8).toBe(255);
    p.update(0.1, { ...NO_INPUT, turnLeft: true });
    expect(p.heading8).toBe(7);
  });

  it('stops at walls and slides along them', () => {
    const p = new PartyController(0, 900, 0);
    p.polygons = [wall];
    p.update(1, { ...NO_INPUT, forward: true });
    expect(p.y).toBeLessThanOrEqual(1000 - PARTY_RADIUS + 0.01);
    const p2 = new PartyController(0, 900, 224); // north-east-ish, into the wall
    p2.polygons = [wall];
    p2.update(0.5, { ...NO_INPUT, forward: true });
    expect(p2.x).toBeGreaterThan(50);
    expect(p2.y).toBeLessThanOrEqual(1000 - PARTY_RADIUS + 0.01);
  });

  it('takes eye height from the height callback', () => {
    const p = new PartyController(10, 20, 0, (x, y) => x + y);
    expect(p.eyeZ).toBe(30 + EYE_HEIGHT);
  });
});
