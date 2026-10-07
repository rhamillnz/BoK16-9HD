import { parseBMX, type IndexedImage } from '../formats/bmx';
import { gdsFileName, parseGds, type GdsRef, type GdsScene, type Hotspot } from '../formats/gds';
import { parsePalette, type Palette } from '../formats/palette';
import { parseSCX } from '../formats/scx';
import { parseAds, parseTtm, selectScript, type TtmScript } from '../formats/ttm';
import type { ReadResource } from './encounterDriver';
import { getFlag, type WorldState } from './state';

/** Scene screens are 320x200 pixels. */
export const SCENE_WIDTH = 320;
export const SCENE_HEIGHT = 200;

export interface SceneImage {
  width: number;
  height: number;
  /** RGBA, row-major, always opaque. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** Fetches resources by name (from the archive or install directory) and returns a reader for them. */
export type FetchResources = (names: readonly string[]) => Promise<ReadResource>;

export interface TownScene {
  ref: GdsRef;
  gds: GdsScene;
  image: SceneImage;
}

// ---- Hotspots --------------------------------------------------------------

/** Event-flag pointers a hotspot condition may test; query and keyword ranges are not flags. */
const isFlagPointer = (p: number) => (p >= 1 && p <= 0xab) || (p >= 0x200 && p <= 0x1fff);

/**
 * Whether a hotspot is available. As in the original: with a flag condition (`checkEventState` set and the
 * low word of `dialog` a flag pointer) the flag must equal the high word; otherwise a set bit n of the chapter
 * mask hides the hotspot in chapter n + 1. The flag range test is our reading of the original's choice
 * categories and is unverified against real data.
 */
export function hotspotActive(h: Hotspot, world: WorldState, chapter: number): boolean {
  const pointer = h.dialog & 0xffff;
  const expected = (h.dialog >>> 16) & 0xffff;
  if (h.checkEventState !== 0 && isFlagPointer(pointer)) return (getFlag(world, pointer) ? 1 : 0) === expected;
  return ((h.chapterMask ^ 0xffff) & (1 << (chapter - 1)) & 0xffff) !== 0;
}

/** Hotspots flagged to run as soon as the scene opens (chapter mask bit 0x8000). */
export const runsImmediately = (h: Hotspot): boolean => (h.chapterMask & 0x8000) !== 0;

export function activeHotspots(gds: GdsScene, world: WorldState, chapter: number): Hotspot[] {
  return gds.hotspots.filter((h) => hotspotActive(h, world, chapter));
}

// ---- Compositing -----------------------------------------------------------

/** Names of every resource the scripts need: palettes, image sets and screens. */
export function scriptResourceNames(scripts: readonly TtmScript[]): string[] {
  const names = new Set<string>();
  for (const s of scripts) {
    for (const p of s.palettes.values()) names.add(p);
    for (const i of s.images.values()) names.add(i.name);
    if (s.screen) names.add(s.screen.name);
  }
  return [...names];
}

interface Clip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function putPixel(
  out: Uint8ClampedArray,
  x: number,
  y: number,
  pal: Palette,
  index: number,
  clip: Clip,
  opaque: boolean,
): void {
  if (x < clip.x0 || y < clip.y0 || x >= clip.x1 || y >= clip.y1) return;
  if (!opaque && index === 0) return;
  const o = (y * SCENE_WIDTH + x) * 4;
  out[o] = pal[index * 4]!;
  out[o + 1] = pal[index * 4 + 1]!;
  out[o + 2] = pal[index * 4 + 2]!;
  out[o + 3] = 255;
}

function blit(
  out: Uint8ClampedArray,
  img: IndexedImage,
  pal: Palette,
  x: number,
  y: number,
  targetW: number,
  targetH: number,
  flipX: boolean,
  flipY: boolean,
  clip: Clip,
): void {
  const w = targetW > 0 ? targetW : img.width;
  const h = targetH > 0 ? targetH : img.height;
  for (let dy = 0; dy < h; dy++) {
    const sy = Math.min(img.height - 1, Math.floor((dy * img.height) / h));
    const srcY = flipY ? img.height - 1 - sy : sy;
    for (let dx = 0; dx < w; dx++) {
      const sx = Math.min(img.width - 1, Math.floor((dx * img.width) / w));
      const srcX = flipX ? img.width - 1 - sx : sx;
      putPixel(out, x + dx, y + dy, pal, img.pixels[srcY * img.width + srcX]!, clip, false);
    }
  }
}

/**
 * A still picture of a scene: for each script in order, its full-screen picture, then every sprite and
 * frame it draws, ignoring animation frames (as the original does for the static town scenes).
 * Missing resources are skipped so a scene with unknown art still opens.
 */
export function composeScene(scripts: readonly TtmScript[], read: ReadResource): SceneImage {
  const rgba = new Uint8ClampedArray(SCENE_WIDTH * SCENE_HEIGHT * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const full: Clip = { x0: 0, y0: 0, x1: SCENE_WIDTH, y1: SCENE_HEIGHT };

  const palettes = new Map<string, Palette | undefined>();
  const palette = (name: string | undefined): Palette | undefined => {
    if (!name) return undefined;
    if (!palettes.has(name)) {
      const bytes = read(name);
      let pal: Palette | undefined;
      try {
        pal = bytes ? parsePalette(bytes) : undefined;
      } catch {
        pal = undefined;
      }
      palettes.set(name, pal);
    }
    return palettes.get(name);
  };
  const imageSets = new Map<string, IndexedImage[] | undefined>();
  const images = (name: string) => {
    if (!imageSets.has(name)) {
      const bytes = read(name);
      let set: IndexedImage[] | undefined;
      try {
        set = bytes ? parseBMX(bytes) : undefined;
      } catch {
        set = undefined;
      }
      imageSets.set(name, set);
    }
    return imageSets.get(name);
  };

  for (const script of scripts) {
    const palFor = (slot: number) => palette(script.palettes.get(slot) ?? script.palettes.get(0));
    let clip = full;

    if (script.screen) {
      const bytes = read(script.screen.name);
      const pal = palFor(script.screen.palette);
      if (bytes && pal) {
        try {
          const screen = parseSCX(bytes);
          const sclip: Clip = {
            x0: 0,
            y0: 0,
            x1: Math.min(SCENE_WIDTH, screen.width),
            y1: Math.min(SCENE_HEIGHT, screen.height),
          };
          for (let y = 0; y < sclip.y1; y++) {
            for (let x = 0; x < sclip.x1; x++)
              putPixel(rgba, x, y, pal, screen.pixels[y * screen.width + x]!, sclip, true);
          }
        } catch {
          // an undecodable screen leaves the previous picture in place
        }
      }
    }

    for (const op of script.ops) {
      if (op.op === 'clip') {
        clip = {
          x0: Math.max(0, op.x),
          y0: Math.max(0, op.y),
          x1: Math.min(SCENE_WIDTH, op.right),
          y1: Math.min(SCENE_HEIGHT, op.bottom),
        };
      } else if (op.op === 'sprite') {
        const slot = script.images.get(op.slot);
        const set = slot && images(slot.name);
        const sprite = set?.[op.index];
        const pal = slot && palFor(slot.palette);
        if (sprite && pal) blit(rgba, sprite, pal, op.x, op.y, op.width, op.height, op.flipX, op.flipY, clip);
      } else if (op.op === 'rect') {
        const pal = palFor(0);
        if (!pal) continue;
        for (let y = op.y; y < op.y + op.height; y++) {
          for (let x = op.x; x < op.x + op.width; x++) {
            const edge = x === op.x || y === op.y || x === op.x + op.width - 1 || y === op.y + op.height - 1;
            if (edge) putPixel(rgba, x, y, pal, op.edge, clip, true);
            else if (op.filled) putPixel(rgba, x, y, pal, op.fill, clip, true);
          }
        }
      } else if (op.op === 'actor') {
        const slot = script.images.get(1);
        const sprite = slot && images(slot.name)?.[0];
        const pal = palFor(0);
        if (sprite && pal)
          blit(rgba, sprite, pal, 160 - (sprite.width >> 1), 112 - sprite.height, 0, 0, false, false, clip);
      }
    }
  }
  return { width: SCENE_WIDTH, height: SCENE_HEIGHT, rgba };
}

/** Load a GDS scene and draw its still picture. Chapter picks the script variant the ADS selects. */
export async function loadTownScene(fetch: FetchResources, ref: GdsRef, chapter: number): Promise<TownScene> {
  const gdsName = gdsFileName(ref);
  const gdsBytes = (await fetch([gdsName]))(gdsName);
  if (!gdsBytes) throw new Error(`town scene not found: ${gdsName}`);
  const gds = parseGds(gdsBytes);

  const readScripts = await fetch([gds.ttm, gds.ads]);
  const ttmBytes = readScripts(gds.ttm);
  const adsBytes = readScripts(gds.ads);
  if (!ttmBytes || !adsBytes) throw new Error(`scene scripts not found: ${gds.ttm} / ${gds.ads}`);
  const ttm = parseTtm(ttmBytes);
  const ads = parseAds(adsBytes);

  const scripts = pickScripts(ttm, ads, [gds.sceneIndex1, gds.sceneIndex2], chapter);
  const read = await fetch(scriptResourceNames(scripts));
  return { ref, gds, image: composeScene(scripts, read) };
}

function pickScripts(
  ttm: Map<number, TtmScript>,
  ads: ReturnType<typeof parseAds>,
  sceneIndices: readonly number[],
  chapter: number,
): TtmScript[] {
  const out: TtmScript[] = [];
  for (const index of sceneIndices) {
    const id = selectScript(ads, index, chapter);
    const script = id === undefined ? undefined : ttm.get(id);
    if (script) out.push(script);
  }
  return out;
}
