import type * as THREE from 'three/webgpu';
import { createPost } from '../render/post';
import { parseQuality, type PostQuality } from '../render/postSettings';

export interface GraphicsHost {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Sun shadows, off on low. */
  setShadows(on: boolean): void;
  /** Grass density of the current zone. */
  setGrass(q: PostQuality): void;
}

const DETAIL: Record<PostQuality, string> = {
  low: 'no post-processing, no shadows, sparse grass',
  medium: 'bloom + colour grade, shadows, normal grass',
  high: 'adds ambient occlusion, dense grass',
};

/** The brief message at the top of the screen when the quality changes. */
function createToast(): (text: string) => void {
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
  let timer = 0;
  return (text) => {
    toast.textContent = text;
    toast.style.opacity = '1';
    clearTimeout(timer);
    timer = window.setTimeout(() => (toast.style.opacity = '0'), 2200);
  };
}

/**
 * Graphics quality: P cycles low/medium/high (?post=low|medium|high sets the start). One setting drives
 * post-processing, sun shadows (off on low) and grass density, and is shown briefly on screen.
 */
export function installGraphics(host: GraphicsHost) {
  const post = createPost(
    host.renderer,
    host.scene,
    host.camera,
    parseQuality(new URLSearchParams(location.search).get('post'), 'medium'),
  );
  const show = createToast();
  const applyGraphics = (announce: boolean) => {
    const q = post.quality;
    host.setShadows(q !== 'low');
    host.setGrass(q);
    if (announce) show(`Graphics: ${q.toUpperCase()} - ${DETAIL[q]}`);
  };
  applyGraphics(false);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && !e.repeat) {
      post.cycle();
      applyGraphics(true);
    }
  });
  return { post, applyGraphics };
}
