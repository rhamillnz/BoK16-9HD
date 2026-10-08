import type { ResourceArchive } from '../formats/archive';
import { parseBMX, type IndexedImage } from '../formats/bmx';
import { parsePalette, type Palette } from '../formats/palette';
import { parseSCX, terrainStrips } from '../formats/scx';
import { parseTBL, zonePrefix, type ModelTable } from '../formats/tbl';
import { isUndergroundZone, undergroundTableName } from './underground';
import {
  parseChapterStart,
  parseWLD,
  parseZoneRef,
  tileName,
  type ChapterStart,
  type WorldItem,
} from '../formats/world';

/** Everything needed to build one outdoor zone, decoded from the original data. */
export interface ZoneData {
  zone: number;
  palette: Palette;
  table: ModelTable;
  /** All placed items across the zone's tiles, including each tile's type-0 ground plane. */
  items: WorldItem[];
  /** ZxxSLOT0..n.BMX images concatenated; indexed by sprite index / textured-face colour. */
  slotImages: IndexedImage[];
  /** Eight terrain strips from ZxxL.SCX (see Terrain in formats/scx.ts). */
  terrain: IndexedImage[];
  tiles: [number, number][];
  /** Mines only: the overhead ("_ug") variants from ZxxM.TBL, same model indices as `table`. */
  overheadTable?: ModelTable;
}

export function loadZone(archive: ResourceArchive, zone: number): ZoneData {
  const p = zonePrefix(zone);
  const palette = parsePalette(archive.get(`${p}.PAL`));
  const table = parseTBL(archive.get(`${p}.TBL`));

  const slotImages: IndexedImage[] = [];
  for (let slot = 0; archive.has(`${p}SLOT${slot}.BMX`); slot++) {
    slotImages.push(...parseBMX(archive.get(`${p}SLOT${slot}.BMX`)));
  }

  // Mines have no ground strips to speak of: tolerate a missing or empty sheet.
  const terrain = archive.has(`${p}L.SCX`) ? terrainStrips(parseSCX(archive.get(`${p}L.SCX`))) : [];
  const tiles = parseZoneRef(archive.get(`${p}REF.DAT`));
  const items: WorldItem[] = [];
  for (const [tx, ty] of tiles) {
    const name = tileName(zone, tx, ty, 'WLD');
    if (!archive.has(name)) continue;
    // Type 0 is both the tile-centre marker and model 0 ("ground"): it is the tile's ground plane.
    items.push(...parseWLD(archive.get(name)));
  }
  const mTable = undergroundTableName(p);
  const overheadTable = isUndergroundZone(zone) && archive.has(mTable) ? parseTBL(archive.get(mTable)) : undefined;
  return { zone, palette, table, items, slotImages, terrain, tiles, overheadTable };
}

export function loadChapterStart(archive: ResourceArchive, chapter: number): ChapterStart {
  return parseChapterStart(archive.get(`CHAP${chapter}.DAT`));
}
