import { Reader } from '../formats/reader';
import { CELL_SIZE, TILE_SIZE } from '../formats/world';

/**
 * Where a teleport or a zone-transition encounter sends the party. The tables are TELEPORT.DAT
 * (dialogue Teleport actions) and DEF_ZONE.DAT (zone encounters, type 8). See docs/formats/dialogue.md.
 */

export interface Destination {
  /** Zone to load; undefined keeps the current zone (a teleport within it). */
  zone: number | undefined;
  tileX: number;
  tileY: number;
  /** World position at the centre of the target cell, in BaK units. */
  x: number;
  y: number;
  /** 8-bit heading, 0 north, counter-clockwise. */
  heading: number;
  /** Town or temple scene to enter on arrival (GDS number). */
  hotspot?: number;
  /** Letter index of the scene within that town (see `gdsLetter`); present with `hotspot`. */
  hotspotChar?: number;
  /**
   * A town or temple teleport whose tile and cell are all zero: it names no map position, only the scene to open.
   * The party stays where it stands (otherwise it would be left at the zone's origin cell, (800, 800)).
   */
  positionless?: boolean;
}

export interface ZoneTransition extends Destination {
  /** Dialogue key shown before the party leaves (0 = none). */
  dialog: number;
}

/** TELEPORT.DAT record: zone, tile x/y, cell x/y (u8 each), heading u16, hotspot u16, hotspot char u16. */
export const TELEPORT_RECORD_SIZE = 11;
/** DEF_ZONE.DAT record: 3 unknown, zone, tile x/y, cell x/y, heading u16, dialogue key u32, 6 unused. */
export const ZONE_RECORD_SIZE = 20;
/** Zone byte meaning "stay in the current zone". */
const SAME_ZONE = 0xff;

export function destinationAt(
  zone: number | undefined,
  tileX: number,
  tileY: number,
  cellX: number,
  cellY: number,
  heading16: number,
): Destination {
  return {
    zone,
    tileX,
    tileY,
    x: tileX * TILE_SIZE + cellX * CELL_SIZE + CELL_SIZE / 2,
    y: tileY * TILE_SIZE + cellY * CELL_SIZE + CELL_SIZE / 2,
    heading: (heading16 >> 8) & 0xff,
  };
}

export function parseTeleports(bytes: Uint8Array): Destination[] {
  const r = new Reader(bytes);
  const out: Destination[] = [];
  while (r.pos + TELEPORT_RECORD_SIZE <= bytes.length) {
    const zone = r.u8();
    const tileX = r.u8();
    const tileY = r.u8();
    const cellX = r.u8();
    const cellY = r.u8();
    const heading = r.u16();
    const hotspot = r.u16() & 0xff;
    const hotspotChar = r.u16() & 0xff;
    const d = destinationAt(zone === SAME_ZONE ? undefined : zone, tileX, tileY, cellX, cellY, heading);
    const positionless = hotspot !== 0 && tileX === 0 && tileY === 0 && cellX === 0 && cellY === 0;
    out.push(hotspot !== 0 ? { ...d, hotspot, hotspotChar, ...(positionless ? { positionless } : {}) } : d);
  }
  return out;
}

export function parseZoneTransitions(bytes: Uint8Array): ZoneTransition[] {
  const r = new Reader(bytes);
  const count = Math.min(r.u32(), Math.floor((bytes.length - 4) / ZONE_RECORD_SIZE));
  const out: ZoneTransition[] = [];
  for (let i = 0; i < count; i++) {
    r.skip(3);
    const zone = r.u8();
    const tileX = r.u8();
    const tileY = r.u8();
    const cellX = r.u8();
    const cellY = r.u8();
    const heading = r.u16();
    const dialog = r.u32();
    r.skip(6);
    out.push({ ...destinationAt(zone, tileX, tileY, cellX, cellY, heading), dialog });
  }
  return out;
}

/** What to do after a transition's destination is known. */
export interface TransitionPlan {
  /** True when the zone scene must be rebuilt; false when the party only moves. */
  reload: boolean;
  zone: number;
  x: number;
  y: number;
  heading: number;
  hotspot?: number;
  hotspotChar?: number;
}

export function planTransition(
  currentZone: number,
  d: Destination,
  here?: { x: number; y: number; heading: number },
): TransitionPlan {
  const zone = d.zone ?? currentZone;
  const stay = d.positionless && here && zone === currentZone;
  return {
    reload: zone !== currentZone,
    zone,
    x: stay ? here.x : d.x,
    y: stay ? here.y : d.y,
    heading: stay ? here.heading : d.heading,
    hotspot: d.hotspot,
    hotspotChar: d.hotspotChar,
  };
}

/**
 * Debug start for `?zone=N`: the first teleport that lands in zone N (its entry point), so a mine
 * starts inside the tunnels. Undefined when no teleport targets the zone.
 */
export function entryPointForZone(zone: number, teleports: readonly Destination[]): Destination | undefined {
  return teleports.find((t) => t.zone === zone && t.hotspot === undefined);
}

/** Whether a destination's tile is one of the zone's tiles (otherwise the party would land in a void). */
export function landsOnZoneTile(
  tiles: readonly (readonly [number, number])[],
  d: Pick<Destination, 'tileX' | 'tileY'>,
) {
  return tiles.some(([tx, ty]) => tx === d.tileX && ty === d.tileY);
}
