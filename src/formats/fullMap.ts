import { Reader } from './reader';

/**
 * Parse FMAP_TWN.DAT: towns on the full-world map.
 * Format:
 *  - u16 x1, x2, y1, y2, z1 (map bounds and unknown value)
 *  - 33 towns:
 *    - u16 type
 *    - null-terminated string: town name
 *    - u16 x, y (coordinates on full map)
 */
export interface Town {
  name: string;
  type: number;
  x: number;
  y: number;
}

export function parseFMapTowns(data: Uint8Array): Town[] {
  const r = new Reader(data);

  // Read map bounds (unused for now)
  r.u16(); // x1
  r.u16(); // x2
  r.u16(); // y1
  r.u16(); // y2
  r.u16(); // z1

  const towns: Town[] = [];
  for (let i = 0; i < 33; i++) {
    const type = r.u16();
    const name = readNullTerminatedString(r);
    const x = r.u16();
    const y = r.u16();
    towns.push({ name, type, x, y });
  }

  return towns;
}

/**
 * Parse FMAP_XY.DAT: for each zone, the full-map positions of its tiles.
 * Format:
 *  - For each zone (0-11):
 *    - u16 nTiles
 *    - nTiles x (u16 x, u16 y)
 */
export interface ZoneTiles {
  zone: number; // 1-12
  tiles: Array<{ x: number; y: number }>;
}

export function parseFMapXY(data: Uint8Array): ZoneTiles[] {
  const r = new Reader(data);
  const zones: ZoneTiles[] = [];

  for (let zone = 0; zone < 12; zone++) {
    const nTiles = r.u16();
    const tiles: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < nTiles; i++) {
      const x = r.u16();
      const y = r.u16();
      tiles.push({ x, y });
    }
    zones.push({ zone: zone + 1, tiles });
  }

  return zones;
}

/**
 * Read a null-terminated ASCII string from a Reader.
 */
function readNullTerminatedString(r: Reader): string {
  const chars: number[] = [];
  while (!r.atEnd()) {
    const byte = r.u8();
    if (byte === 0) break;
    chars.push(byte);
  }
  return String.fromCharCode(...chars);
}

/**
 * For each zone, find the towns that fall within or nearest to its tile positions.
 * Name the zone after the most central town(s).
 * Zones 10-12 are underground mines: label with " mines" or "Mine 1/2/3" if no town.
 */
/** Zone 9 has no full-map tiles: it is Timirianya, which the original full map does not show. */
export const TIMIRIANYA_ZONE = 9;

export function generateZoneNames(towns: Town[], zones: ZoneTiles[]): string[] {
  const names: string[] = [];

  for (const zone of zones) {
    // Special handling for zones with no tiles
    if (zone.tiles.length === 0) {
      if (zone.zone >= 10) {
        names.push(`Mine ${zone.zone - 9}`);
      } else if (zone.zone === TIMIRIANYA_ZONE) {
        // The original full map leaves out Timirianya, so FMAP_XY has no tiles for it.
        names.push('Timirianya');
      } else {
        names.push(`Zone ${zone.zone}`);
      }
      continue;
    }

    // Find the bounding box of this zone's tiles
    const xs = zone.tiles.map((t) => t.x);
    const ys = zone.tiles.map((t) => t.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Find towns within the zone or nearest to it
    const townsWithDistance = towns.map((town) => {
      // Check if town is within the zone's bounding box
      const isInside = town.x >= minX && town.x <= maxX && town.y >= minY && town.y <= maxY;
      // Distance to zone center (euclidean)
      const distance = Math.sqrt((town.x - centerX) ** 2 + (town.y - centerY) ** 2);
      return { town, isInside, distance };
    });

    // Prefer towns inside the zone; if none, use nearest ones
    let candidates = townsWithDistance.filter((t) => t.isInside);
    if (candidates.length === 0) {
      // Use the 2 nearest towns
      candidates = townsWithDistance.sort((a, b) => a.distance - b.distance).slice(0, 2);
    } else {
      // Use the 2 most central towns
      candidates = candidates.sort((a, b) => a.distance - b.distance).slice(0, 2);
    }

    const zoneName = candidates
      .map((c) => c.town.name)
      .filter((n) => n.length > 0)
      .join(' / ');

    if (zoneName.length === 0) {
      if (zone.zone >= 10) {
        names.push(`Mine ${zone.zone - 9}`);
      } else if (zone.zone === TIMIRIANYA_ZONE) {
        // The original full map leaves out Timirianya, so FMAP_XY has no tiles for it.
        names.push('Timirianya');
      } else {
        names.push(`Zone ${zone.zone}`);
      }
    } else if (zone.zone >= 10) {
      // Underground zones: append "mines"
      names.push(`${zoneName} mines`);
    } else {
      names.push(zoneName);
    }
  }

  return names;
}

/**
 * The two lines of a zone's button: the area (its first town; "Mines" for the mines) and which
 * zone it is ("Zone 3", or "Mine 2" for zones 10-12), so zones sharing a town stay distinct.
 */
export function zoneButtonLines(zone: number, name: string): [string, string] {
  const mine = zone >= 10;
  const area = mine ? 'Mines' : (name.split(' / ')[0] ?? name);
  return [area, mine ? `Mine ${zone - 9}` : `Zone ${zone}`];
}

/** `text`, cut short with a full stop (the game font has no ellipsis) until `measure(text)` fits in `maxWidth`. */
export function fitText(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  for (let n = text.length - 1; n > 0; n--) {
    const cut = `${text.slice(0, n).trimEnd()}.`;
    if (measure(cut) <= maxWidth) return cut;
  }
  return '.';
}
