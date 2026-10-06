import * as THREE from 'three/webgpu';

/** Design target. The canvas is always 16:9 and letterboxed inside the window. */
export const TARGET_WIDTH = 2560;
export const TARGET_HEIGHT = 1440;
const ASPECT = TARGET_WIDTH / TARGET_HEIGHT;

export interface Stage {
  renderer: THREE.WebGPURenderer;
  camera: THREE.PerspectiveCamera;
  backend: 'WebGPU' | 'WebGL2';
}

export async function createStage(container: HTMLElement): Promise<Stage> {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  container.append(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(60, ASPECT, 1, 200_000);

  const fit = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    // Largest 16:9 rectangle that fits the window.
    const width = Math.min(w, Math.round(h * ASPECT));
    const height = Math.round(width / ASPECT);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
  };
  fit();
  window.addEventListener('resize', fit);

  return { renderer, camera, backend };
}
