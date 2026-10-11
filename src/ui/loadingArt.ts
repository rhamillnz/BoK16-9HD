import { sceneHdUrl } from '../game/sceneHd';

/**
 * Pictures for the loading screen: the upscaled town views (the first scene of each of the twelve towns, GDS1A to
 * GDS12A, the one shown on entering it) from `scripts/export-town-scenes.ts` and tools/upscale. They live in the gitignored art folder; any
 * that is missing is skipped, and with none the loading screen falls back to the title scroll.
 */
export const TOWN_VIEWS: readonly string[] = [
  'a7c906e9', // GDS1A
  'f3d666a6', // GDS2A
  '1f7abd70', // GDS3A
  '059be716', // GDS4A
  'bf2d32a4', // GDS5A
  '8ceef69f', // GDS6A
  '2f9d4b8e', // GDS7A
  'f995af54', // GDS8A
  '7addde66', // GDS9A
  '922add5e', // GDS10A
  '678f1097', // GDS11A
  '0095ebb8', // GDS12A
];

/** The painted strip inside a 320x200 town scene (the rest is the frame and the black text area), in scene pixels. */
export const PANORAMA = { x: 16, y: 12, width: 287, height: 99 } as const;

/** Seconds each picture is shown, and of that the crossfade into the next. */
export const SLIDE_SECONDS = 6;
export const FADE_SECONDS = 1.5;

/** The slides in a shuffled order (`random` returns 0..1). */
export function slideOrder(count: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * Where the slideshow is at `seconds`: the slide shown, the next one, how far the fade into it has gone (0..1), and
 * each one's slow zoom (1 to 1.08 over its time on screen).
 */
export function slideAt(
  seconds: number,
  count: number,
): { current: number; next: number; fade: number; zoom: number; nextZoom: number } {
  const n = Math.max(1, count);
  const k = Math.floor(seconds / SLIDE_SECONDS);
  const t = seconds - k * SLIDE_SECONDS;
  const fade = Math.max(0, (t - (SLIDE_SECONDS - FADE_SECONDS)) / FADE_SECONDS);
  // A slide's zoom runs from its fade in to its fade out, so it carries on smoothly when it becomes the current one.
  const zoom = 1 + 0.08 * ((t + FADE_SECONDS) / (SLIDE_SECONDS + FADE_SECONDS));
  const nextZoom = 1 + 0.08 * (Math.max(0, t - (SLIDE_SECONDS - FADE_SECONDS)) / (SLIDE_SECONDS + FADE_SECONDS));
  return { current: k % n, next: (k + 1) % n, fade, zoom, nextZoom };
}

/**
 * Loads the town views one after another (in a shuffled order) into `slides`, so the slideshow can start with the
 * first while the rest arrive. Missing pictures are skipped; without the art folder `slides` stays empty.
 */
export async function loadTownViews(slides: HTMLImageElement[]): Promise<void> {
  for (const i of slideOrder(TOWN_VIEWS.length)) {
    const img = new Image();
    img.src = sceneHdUrl(TOWN_VIEWS[i]!);
    try {
      await img.decode();
      slides.push(img);
    } catch {
      // not upscaled on this machine
    }
  }
}
