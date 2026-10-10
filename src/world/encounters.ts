import { parseTileEncounters, type EncounterRecord } from '../formats/encounters';
import { CELL_SIZE, TILE_SIZE } from '../formats/world';
import { getFlag, type WorldState } from '../game/state';

/**
 * Which encounter trigger rectangles the party is standing in.
 * World units are BaK's: x east, y north, 64000 per tile, 1600 per cell.
 */

export interface PlacedEncounter {
  record: EncounterRecord;
  tileX: number;
  tileY: number;
  /** World-space rectangle, half-open: minX <= x < maxX. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function placeEncounter(record: EncounterRecord, tileX: number, tileY: number): PlacedEncounter {
  const x0 = tileX * TILE_SIZE;
  const y0 = tileY * TILE_SIZE;
  const lo = (a: number, b: number) => Math.min(a, b) * CELL_SIZE;
  const hi = (a: number, b: number) => (Math.max(a, b) + 1) * CELL_SIZE;
  return {
    record,
    tileX,
    tileY,
    minX: x0 + lo(record.left, record.right),
    maxX: x0 + hi(record.left, record.right),
    minY: y0 + lo(record.top, record.bottom),
    maxY: y0 + hi(record.top, record.bottom),
  };
}

/** Per-tile encounter store for one chapter. */
export class EncounterMap {
  private readonly byTile = new Map<number, PlacedEncounter[]>();

  constructor(readonly chapter: number) {}

  private key(tx: number, ty: number): number {
    return ty * 1024 + tx;
  }

  /** Add a tile's encounters from its raw TzzXXYY.DAT bytes. */
  addTile(tileX: number, tileY: number, bytes: Uint8Array): void {
    const placed = parseTileEncounters(bytes, this.chapter).map((r) => placeEncounter(r, tileX, tileY));
    this.byTile.set(this.key(tileX, tileY), placed);
  }

  /** Every encounter of every loaded tile. */
  all(): PlacedEncounter[] {
    return [...this.byTile.values()].flat();
  }

  tileEncounters(tileX: number, tileY: number): readonly PlacedEncounter[] {
    return this.byTile.get(this.key(tileX, tileY)) ?? [];
  }

  /** Every encounter whose rectangle contains the point, ignoring event flags. */
  at(x: number, y: number): PlacedEncounter[] {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    return this.tileEncounters(tx, ty).filter((e) => x >= e.minX && x < e.maxX && y >= e.minY && y < e.maxY);
  }
}

/**
 * BaKGL's activity test: a required flag must be set, an inhibit flag must be clear
 * (0 means "no flag"). Per-encounter "already seen" state lives in the save and is
 * supplied by `seen` when the caller tracks it.
 */
export function isEncounterActive(
  enc: PlacedEncounter,
  state: WorldState,
  seen?: (e: PlacedEncounter) => boolean,
): boolean {
  const { requiredState, inhibitState } = enc.record;
  if (requiredState !== 0 && !getFlag(state, requiredState)) return false;
  if (inhibitState !== 0 && getFlag(state, inhibitState)) return false;
  return !(seen && seen(enc));
}

/** Active encounters at a world position, in file order. */
export function triggeredAt(
  map: EncounterMap,
  state: WorldState,
  x: number,
  y: number,
  seen?: (e: PlacedEncounter) => boolean,
): PlacedEncounter[] {
  return map.at(x, y).filter((e) => isEncounterActive(e, state, seen));
}
