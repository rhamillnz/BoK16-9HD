import { headingToVector, normalizeHeading } from './partyController';

/**
 * Follow Road (manual p. 16): with it on, walking forward keeps the party on the road, turning with it, and
 * stops at a fork or a T junction so the player can choose a branch. Pure steering over a road mask (BaK world
 * units: x east, y north).
 */

export interface RoadMask {
  get(x: number, y: number): boolean;
}

/** What to do this frame: steer to a heading, or stop (a fork or junction ahead, or the road ends). */
export type FollowStep = { kind: 'steer'; heading: number } | { kind: 'fork' } | { kind: 'end' };

/** Heading units (256 a circle) between the directions probed, and the widest turn looked at either side. */
const PROBE_STEP = 4;
const PROBE_SPAN = 60;
/** How far along each probe the road is sampled, and how far it must run to count as a way on. */
const SAMPLE = 100;
const REACH = 1200;
const MIN_RUN = 700;
/** Width checked either side to count as standing in the middle of the road. */
const CENTRE_HALF_WIDTH = 120;

/** Clear road along `heading` from (x, y), in world units (up to REACH). */
export function roadRun(mask: RoadMask, x: number, y: number, heading: number): number {
  const d = headingToVector(heading);
  let run = 0;
  for (let t = SAMPLE; t <= REACH; t += SAMPLE) {
    if (!mask.get(x + d.x * t, y + d.y * t)) break;
    run = t;
  }
  return run;
}

/** Standing on the road with road on both sides: the only place Follow Road can be switched on. */
export function onRoadCentre(mask: RoadMask, x: number, y: number, heading: number): boolean {
  if (!mask.get(x, y)) return false;
  const side = headingToVector(heading + 64);
  return (
    mask.get(x + side.x * CENTRE_HALF_WIDTH, y + side.y * CENTRE_HALF_WIDTH) &&
    mask.get(x - side.x * CENTRE_HALF_WIDTH, y - side.y * CENTRE_HALF_WIDTH)
  );
}

/**
 * The ways on from (x, y) roughly ahead: runs of neighbouring probe directions where the road goes on at least
 * MIN_RUN, each as the middle of its run (offsets from `heading`, heading units).
 */
export function waysOn(mask: RoadMask, x: number, y: number, heading: number): number[] {
  const ways: number[] = [];
  let start: number | undefined;
  for (let o = -PROBE_SPAN; o <= PROBE_SPAN + PROBE_STEP; o += PROBE_STEP) {
    const open = o <= PROBE_SPAN && roadRun(mask, x, y, heading + o) >= MIN_RUN;
    if (open && start === undefined) start = o;
    if (!open && start !== undefined) {
      ways.push((start + o - PROBE_STEP) / 2);
      start = undefined;
    }
  }
  return ways;
}

/**
 * One step of road following. `committed`: the party has just picked a branch (it turned at a fork), so take
 * the way nearest its heading instead of stopping again.
 */
export function followRoad(mask: RoadMask, x: number, y: number, heading: number, committed = false): FollowStep {
  const ways = waysOn(mask, x, y, heading);
  if (ways.length === 0) return { kind: 'end' };
  if (ways.length > 1 && !committed) return { kind: 'fork' };
  const best = ways.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  return { kind: 'steer', heading: normalizeHeading(heading + best) };
}
