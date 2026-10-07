import * as THREE from 'three/webgpu';
import { AssetOverrides } from '../assets/overrides';
import type { ZoneData } from '../world/zone';
import { overriddenModelNames, slotTextureUrl, type ZoneOverridePlan } from './overrideResolve';
import { usedSlotImages } from './zoneScene';

export type { ZoneOverridePlan };

/** True when `url` serves an image (the dev server's SPA fallback answers misses with HTML). */
async function imageExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

/**
 * Loads everything the zone's overrides need: model .glb files listed in the manifest and
 * upscaled slot textures that exist under /art. Anything missing silently falls back to the
 * original data, so this never throws.
 */
export async function prepareZoneOverrides(zone: ZoneData, overrides?: AssetOverrides): Promise<ZoneOverridePlan> {
  const plan: ZoneOverridePlan = { models: new Map(), slotTextures: new Map() };
  try {
    overrides ??= await AssetOverrides.fromUrl();
  } catch (err) {
    console.warn('Override manifest unavailable, using original assets', err);
  }

  const loader = new THREE.TextureLoader();
  await Promise.all([
    ...(overrides
      ? [...overriddenModelNames(zone.items, zone.table, (n) => overrides.has(n))].map(async (name) => {
          const r = await overrides.resolve(name);
          if (!r.fallback) plan.models.set(name, r.scene);
        })
      : []),
    ...usedSlotImages(zone).map(async (index) => {
      const url = slotTextureUrl(zone.zone, index);
      if (!(await imageExists(url))) return;
      try {
        const tex = await loader.loadAsync(url);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.generateMipmaps = true;
        plan.slotTextures.set(index, tex);
      } catch (err) {
        console.warn(`Upscaled slot ${index} failed to load, using original`, err);
      }
    }),
  ]);
  return plan;
}
