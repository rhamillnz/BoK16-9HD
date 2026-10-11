import * as THREE from 'three/webgpu';

/** Leaf materials of the nature kit that come in autumn red; they are recoloured to olive green on load. */
export const RED_LEAF_MATERIAL = /^Leaves_TwistedTree/;

/** Olive green (sRGB 0..1 per unit of the source's red channel), close to the kit's other leaves. */
const OLIVE = [0.66, 0.8, 0.28] as const;

/**
 * Recolour red leaf pixels (RGBA bytes, in place) to olive green: the red channel carries the leaf's light and
 * dark, a little of the green channel keeps its highlights. Alpha is untouched.
 */
export function redLeavesToOlive(data: Uint8ClampedArray | Uint8Array): void {
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i]! + data[i + 1]! * 0.5;
    data[i] = Math.min(255, v * OLIVE[0]);
    data[i + 1] = Math.min(255, v * OLIVE[1]);
    data[i + 2] = Math.min(255, v * OLIVE[2]);
  }
}

/** Swap the texture of every red leaf material in `scene` for an olive copy (browser only; no-op without a DOM). */
export function recolourRedLeaves(scene: THREE.Object3D): void {
  if (typeof document === 'undefined') return;
  const done = new Map<THREE.Texture, THREE.Texture>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!RED_LEAF_MATERIAL.test(mat.name) || !mat.map?.image) continue;
      let map = done.get(mat.map);
      if (!map) {
        const image = mat.map.image as CanvasImageSource & { width: number; height: number };
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) continue;
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        redLeavesToOlive(pixels.data);
        ctx.putImageData(pixels, 0, 0);
        map = mat.map.clone();
        map.image = canvas;
        map.needsUpdate = true;
        done.set(mat.map, map);
      }
      mat.map = map;
      mat.needsUpdate = true;
    }
  });
}
