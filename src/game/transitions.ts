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
    tileX, tileY,
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
    out.push(hotspot !== 0 ? { ...d, hotspot, hotspotChar } : d);
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

export function planTransition(currentZone: number, d: Destination): TransitionPlan {
  const zone = d.zone ?? currentZone;
  return { reload: zone !== currentZone, zone, x: d.x, y: d.y, heading: d.heading, hotspot: d.hotspot, hotspotChar: d.hotspotChar };
}

