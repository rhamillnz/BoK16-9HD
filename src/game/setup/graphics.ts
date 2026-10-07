import * as THREE from 'three/webgpu';
import { createStage } from '../../render/stage';
import { createPost } from '../../render/post';
import { parseQuality } from '../../render/postSettings';
import { createSky, DOME_RADIUS } from '../../render/sky';
import { installPerf } from '../../render/perf';

export async function setupGraphics(stageEl: HTMLElement) {
  const { renderer, camera, backend } = await createStage(stageEl);
  const scene = new THREE.Scene();
  const sky = createSky(scene);

  // World units: 1 unit = 100 game units.
  camera.near = 0.1;
  camera.far = DOME_RADIUS * 4;
  camera.updateProjectionMatrix();

  const tickPerf = installPerf(renderer, scene);

  const post = createPost(
    renderer,
    scene,
    camera,
    parseQuality(new URLSearchParams(location.search).get('post'), 'medium'),
  );

  const toast = Object.assign(document.createElement('div'), { id: 'toast' });
  Object.assign(toast.style, {
    position: 'absolute',
    top: '12%',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 22px',
    background: 'rgba(20,16,10,0.75)',
    border: '2px solid #c9a24a',
    color: '#f3e6c4',
    font: '600 22px system-ui, sans-serif',
    borderRadius: '6px',
    pointerEvents: 'none',
    transition: 'opacity 0.4s',
    opacity: '0',
  });
  document.body.append(toast);
  let toastTimer = 0;

  const applyGraphics = (announce: boolean, setGrassQuality: (q: 'low' | 'medium' | 'high') => void) => {
    const q = post.quality;
    sky.setShadows(q !== 'low');
    setGrassQuality(q);
    if (!announce) return;
    const detail = {
      low: 'no post-processing, no shadows, sparse grass',
      medium: 'bloom + colour grade, shadows, normal grass',
      high: 'adds ambient occlusion, dense grass',
    }[q];
    toast.textContent = `Graphics: ${q.toUpperCase()} - ${detail}`;
    toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.style.opacity = '0'), 2200);
  };

  return { renderer, camera, backend, scene, sky, post, applyGraphics, tickPerf };
}
