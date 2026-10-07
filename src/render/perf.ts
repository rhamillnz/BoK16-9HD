import type * as THREE from 'three/webgpu';
import { beyondFar } from './cullMath';
import { FOG_FAR } from './sky';

interface ChunkInfo { x: number; z: number; r: number; /** Own cull distance (default: the fog's far plane). */ far?: number }

/** Hide instanced billboard chunks that are fully inside the fog's far plane's shadow (beyond it). */
export function cullChunks(root: THREE.Object3D, eyeX: number, eyeZ: number, far = FOG_FAR): number {
  let hidden = 0;
  for (const child of root.children) {
    const c = child.userData.chunk as ChunkInfo | undefined;
    if (!c) continue;
    child.visible = !beyondFar(eyeX, eyeZ, c.x, c.z, c.r, c.far ?? far);
    if (!child.visible) hidden++;
  }
  return hidden;
}

/**
 * Distance culling for billboard chunks plus a debug overlay (F3) with frame time and renderer stats.
 * Call the returned `tick` once per frame, before rendering.
 */
export function installPerf(renderer: THREE.WebGPURenderer, scene: THREE.Scene) {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;right:8px;top:8px;margin:0;padding:6px 8px;background:#000a;color:#9f9;font:11px monospace;pointer-events:none;display:none;z-index:50';
  document.body.appendChild(el);
  let shown = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3' && !e.repeat) {
      e.preventDefault();
      shown = !shown;
      el.style.display = shown ? 'block' : 'none';
    }
  });

  let acc = 0;
  let frames = 0;
  let worst = 0;
  let hidden = 0;
  return (camera: THREE.Camera, dt: number): void => {
    hidden = 0;
    for (const child of scene.children) hidden += cullChunks(child, camera.position.x, camera.position.z);
    acc += dt;
    frames++;
    worst = Math.max(worst, dt);
    if (acc < 0.5) return;
    if (shown) {
      const info = renderer.info;
      el.textContent =
        `${(frames / acc).toFixed(0)} fps  avg ${((acc / frames) * 1000).toFixed(1)} ms  worst ${(worst * 1000).toFixed(1)} ms\n` +
        `draw calls ${info.render.drawCalls}  tris ${info.render.triangles}\n` +
        `geometries ${info.memory.geometries}  textures ${info.memory.textures}\n` +
        `billboard chunks culled by distance ${hidden}`;
    }
    acc = 0;
    frames = 0;
    worst = 0;
  };
}
