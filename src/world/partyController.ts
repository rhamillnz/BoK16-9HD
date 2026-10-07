import type { PerspectiveCamera } from 'three/webgpu';
import { headingToRadians } from '../formats/world';
import { slideMove, type CollisionPolygon, type Vec2 } from './collision';

/**
 * First-person party movement in BaK units (x east, y north). Heading is an 8-bit angle,
 * counter-clockwise from north: 0 = north, 64 = west, 128 = south, 192 = east.
 */

/** Eye height above the ground, in BaK units (raised 20% from the original's 100 to sit at head height against the HD buildings). */
export const EYE_HEIGHT = 120;
/** Walking speed in BaK units per second. */
export const WALK_SPEED = 400;
/** Running speed multiplier (Shift). */
export const RUN_MULTIPLIER = 2;
/** Turn rate in 8-bit heading units per second (256 = a full circle). */
export const TURN_RATE = 80;
/** Collision radius of the party in BaK units. */
export const PARTY_RADIUS = 30;
/** Divisor from BaK units to render units (gWorldScale). */
export const WORLD_SCALE = 100;

export interface PartyInput {
  forward: boolean;
  back: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  run: boolean;
}

export const NO_INPUT: Readonly<PartyInput> = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  run: false,
};

/** Wraps a heading into [0, 256). */
export function normalizeHeading(h: number): number {
  return ((h % 256) + 256) % 256;
}

/** Unit vector (x east, y north) the party faces at the given heading. */
export function headingToVector(h: number): Vec2 {
  const a = headingToRadians(h);
  return { x: -Math.sin(a), y: Math.cos(a) };
}

/** Turning left (counter-clockwise) increases the heading. */
export function stepHeading(heading: number, turn: -1 | 0 | 1, dt: number): number {
  return normalizeHeading(heading + turn * TURN_RATE * dt);
}

/** Displacement for one frame, in BaK units. Opposing keys cancel. */
export function walkDelta(heading: number, move: -1 | 0 | 1, run: boolean, dt: number): Vec2 {
  const speed = WALK_SPEED * (run ? RUN_MULTIPLIER : 1) * move * dt;
  const v = headingToVector(heading);
  return { x: v.x * speed, y: v.y * speed };
}

export class PartyController {
  x: number;
  y: number;
  /** Float heading in [0, 256); `heading8` gives the integer value the game would store. */
  heading: number;
  polygons: readonly CollisionPolygon[] = [];

  constructor(
    x = 0,
    y = 0,
    heading = 0,
    private readonly getHeight: (x: number, y: number) => number = () => 0,
  ) {
    this.x = x;
    this.y = y;
    this.heading = normalizeHeading(heading);
  }

  get heading8(): number {
    return Math.floor(this.heading) & 0xff;
  }

  get eyeZ(): number {
    return this.getHeight(this.x, this.y) + EYE_HEIGHT;
  }

  setPosition(x: number, y: number, heading = this.heading): void {
    this.x = x;
    this.y = y;
    this.heading = normalizeHeading(heading);
  }

  update(dt: number, input: Readonly<PartyInput>): void {
    const turn = (Number(input.turnLeft) - Number(input.turnRight)) as -1 | 0 | 1;
    const move = (Number(input.forward) - Number(input.back)) as -1 | 0 | 1;
    this.heading = stepHeading(this.heading, turn, dt);
    if (move === 0) return;
    const p = slideMove({ x: this.x, y: this.y }, walkDelta(this.heading, move, input.run, dt), PARTY_RADIUS, this.polygons);
    this.x = p.x;
    this.y = p.y;
  }

  /** Places the camera: render x = x/scale, y = height/scale, z = -y/scale. */
  applyToCamera(camera: PerspectiveCamera): void {
    camera.position.set(this.x / WORLD_SCALE, this.eyeZ / WORLD_SCALE, -this.y / WORLD_SCALE);
    camera.rotation.set(0, headingToRadians(this.heading), 0, 'YXZ');
  }
}

/** Keyboard binding: arrows or WASD, Shift to run. */
export class PartyKeyboard {
  private readonly keys = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.keys.add(e.code));
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  clear(): void {
    this.keys.clear();
  }

  read(): PartyInput {
    const k = this.keys;
    return {
      forward: k.has('ArrowUp') || k.has('KeyW'),
      back: k.has('ArrowDown') || k.has('KeyS'),
      turnLeft: k.has('ArrowLeft') || k.has('KeyA'),
      turnRight: k.has('ArrowRight') || k.has('KeyD'),
      run: k.has('ShiftLeft') || k.has('ShiftRight'),
    };
  }
}
