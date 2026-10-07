/**
 * Underground (mine) zones. BaKGL treats zones 10, 11 and 12 as underground: the tunnels, rooms and
 * their ceilings are ordinary models in the zone's tables, there is no sky, the background is black
 * and walking is half speed. `ZxxM.TBL` holds an overhead ("_ug" suffix) variant of each model for
 * the map view. See docs/formats/zones-and-models.md.
 */

export const UNDERGROUND_ZONES: readonly number[] = [10, 11, 12];

export function isUndergroundZone(zone: number): boolean {
  return UNDERGROUND_ZONES.includes(zone);
}

/** Walking speed multiplier below ground. */
export const UNDERGROUND_SPEED_SCALE = 0.5;

export const speedScaleForZone = (zone: number): number => (isUndergroundZone(zone) ? UNDERGROUND_SPEED_SCALE : 1);

/** Overhead variant name of a model: "m_door" -> "m_door_ug". */
export const undergroundModelName = (name: string): string => `${name}_ug`;

/** Table file of the overhead models for an underground zone: Z10 -> "Z10M.TBL". */
export const undergroundTableName = (prefix: string): string => `${prefix}M.TBL`;

/** Cave look, in render units (1 unit = 100 game units; a cell is 16 units). */
export const MINE_LOOK = {
  fogColor: 0x050403,
  fogNear: 3,
  fogFar: 42,
  /** Faint cool bounce so unlit stone is never pure black. */
  hemiSky: 0x2a3140,
  hemiGround: 0x120e0a,
  hemiIntensity: 0.35,
  torchColor: 0xffb060,
  torchIntensity: 420,
  torchDistance: 34,
  torchDecay: 2,
} as const;

/** Lantern flicker multiplier (about 0.9-1.1) for a time in seconds; smooth and deterministic. */
export function torchFlicker(seconds: number): number {
  return 1 + 0.05 * Math.sin(seconds * 7.3) + 0.03 * Math.sin(seconds * 17.9 + 1.3) + 0.02 * Math.sin(seconds * 3.1 + 0.4);
}
