/**
 * HD replacements for the 320x200 town-scene pictures. A scene picture is composed at load time from
 * the original images (and depends on the chapter), so replacements are keyed by a hash of the
 * composed RGBA pixels: `/art/scenes-4x/<hash>.png`, made by `scripts/export-town-scenes.ts` and
 * `tools/upscale`. A missing file just means the original picture is used.
 */

/** FNV-1a over the RGB bytes, as 8 hex digits (alpha is always opaque). */
export function sceneHash(rgba: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < rgba.length; i++) {
    if ((i & 3) === 3) continue;
    h = Math.imul(h ^ rgba[i]!, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const sceneHdUrl = (hash: string): string => `/art/scenes-4x/${hash}.png`;

/** The upscaled picture for composed scene pixels, or undefined when none exists or it fails to load. */
export async function loadSceneHd(rgba: ArrayLike<number>): Promise<HTMLImageElement | undefined> {
  const url = sceneHdUrl(sceneHash(rgba));
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return undefined;
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return undefined;
  }
}
