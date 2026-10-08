import { parseBMX } from '../formats/bmx';
import { parsePalette } from '../formats/palette';
import { portraitCanvases } from './partyBar';

/** Actors whose portrait file carries an "A" suffix (the palette does not). */
const SUFFIXED = new Set([9, 12, 18, 30]);

/** Resource names of a dialogue actor's portrait: ACT0NN.BMX (ACT0NNA.BMX for a few) and ACT0NN.PAL. */
export function speakerPortraitFiles(actor: number): { bmx: string; pal: string } {
  const base = `ACT${String(actor).padStart(3, '0')}`;
  return { bmx: `${base}${SUFFIXED.has(actor) ? 'A' : ''}.BMX`, pal: `${base}.PAL` };
}

/** Loads and caches dialogue portraits (image 0 of ACTnnn.BMX) by actor number; undefined when there is none. */
export function speakerPortraitLoader(archive: {
  has(name: string): boolean;
  get(name: string): Uint8Array;
}): (actor: number) => HTMLCanvasElement | undefined {
  const cache = new Map<number, HTMLCanvasElement | undefined>();
  return (actor) => {
    if (cache.has(actor)) return cache.get(actor);
    let canvas: HTMLCanvasElement | undefined;
    try {
      const f = speakerPortraitFiles(actor);
      if (archive.has(f.bmx) && archive.has(f.pal)) {
        const img = parseBMX(archive.get(f.bmx))[0];
        if (img && img.width > 0 && img.height > 0)
          canvas = portraitCanvases([img], parsePalette(archive.get(f.pal)))[0];
      }
    } catch (err) {
      console.warn(`Speaker portrait ${actor} failed:`, err);
    }
    cache.set(actor, canvas);
    return canvas;
  };
}
