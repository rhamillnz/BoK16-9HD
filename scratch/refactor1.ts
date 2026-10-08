import * as fs from 'fs';

let main = fs.readFileSync('src/game/main.ts', 'utf8');

main = main.replace(
`import { makeDialogEnv } from './dialogEnv';
import * as THREE from 'three/webgpu';
import { createStage } from '../render/stage';
import { FlyCamera } from '../render/flyCamera';
import { createPost } from '../render/post';
import { parseQuality } from '../render/postSettings';
import { createSky, DOME_RADIUS } from '../render/sky';
import { PartyController, PartyKeyboard, NO_INPUT } from '../world/partyController';
import { DEBUG_TIME_STEP, GameClock } from './clock';
import { ResourceArchive } from '../formats/archive';
import { parseFNT } from '../formats/fnt';
import { parseBMX } from '../formats/bmx';
import { parsePalette } from '../formats/palette';
import { parseGam } from '../formats/gam';
import { parseObjInfo } from '../formats/objinfo';
import { loadItemIcons } from '../data/itemIcons';`,
`import { makeDialogEnv } from './dialogEnv';
import * as THREE from 'three/webgpu';
import { FlyCamera } from '../render/flyCamera';
import { PartyController, PartyKeyboard, NO_INPUT } from '../world/partyController';
import { DEBUG_TIME_STEP, GameClock } from './clock';
import { ResourceArchive } from '../formats/archive';
import { parseGam } from '../formats/gam';
import { parseObjInfo } from '../formats/objinfo';
import { setupGraphics } from './setup/graphics';
import { setupUI } from './setup/ui';
import { setupAudio } from './setup/audio';`
);

// Remove tickPerf import and UI imports
main = main.replace(`import { installPerf } from '../render/perf';\n`, '');
main = main.replace(`import { mountHud } from '../ui/hud';\n`, '');
main = main.replace(`import { createBrowserMusicPlayer } from '../audio/music';\nimport { songForZone } from '../audio/songs';\nimport { installSfx } from '../audio/sfxWiring';\n`, '');
main = main.replace(`import { portraitCanvases } from '../ui/partyBar';\n`, '');
main = main.replace(`import { parseQuality } from '../render/postSettings';\n`, '');
main = main.replace(`import { createSky, DOME_RADIUS } from '../render/sky';\n`, '');
main = main.replace(`import { createStage } from '../render/stage';\n`, '');
main = main.replace(`import { createPost } from '../render/post';\n`, '');

// Replace stage setup
main = main.replace(
`const { renderer, camera, backend } = await createStage(stageEl);
const scene = new THREE.Scene();
const sky = createSky(scene);

// World units: 1 unit = 100 game units.
camera.near = 0.1;
camera.far = DOME_RADIUS * 4;
camera.updateProjectionMatrix();`,
`const { renderer, camera, backend, scene, sky, post, applyGraphics, tickPerf } = await setupGraphics(stageEl);`
);

// Replace HUD setup
main = main.replace(
`// HUD screens: I inventory, C character sheet, Esc closes; movement is ignored while one is open.
const screens = mountHud(document.body, {
  font: parseFNT(archive.get('GAME.FNT')),
  save,
  items: parseObjInfo(archive.get('OBJINFO.DAT')).items,
  icons: loadItemIcons(archive),
  portraits: portraitCanvases(parseBMX(archive.get('HEADS.BMX')), parsePalette(archive.get('OPTIONS.PAL'))),
});`,
`// HUD screens: I inventory, C character sheet, Esc closes; movement is ignored while one is open.
const screens = setupUI(archive, save);`
);

// Replace Audio setup
main = main.replace(
`// Zone music: the player resumes on the first gesture; M toggles mute. ?song=N overrides the zone song.
const music = createBrowserMusicPlayer({ volume: 0.7 });
void music.play(num('song', songForZone(start.zone))).catch((err) => console.warn('Music unavailable:', err));
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) music.toggleMute();
});
installSfx(); // sound effects from frp.sx; other modules play through src/audio/sfxBus.ts`,
`// Zone music: the player resumes on the first gesture; M toggles mute. ?song=N overrides the zone song.
const { music } = setupAudio(start.zone);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) music.toggleMute();
});`
);

// Remove tickPerf definition since it's now exported from setupGraphics
main = main.replace(`const tickPerf = installPerf(renderer, scene);\n`, '');

// Remove Graphics post definition and toast logic
main = main.replace(
`// Graphics quality: P cycles low/medium/high (?post=low|medium|high sets the start). One setting
// drives post-processing, sun shadows (off on low) and grass density, and is shown briefly on screen.
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
const applyGraphics = (announce: boolean) => {
  const q = post.quality;
  sky.setShadows(q !== 'low');
  zoneHost.current.grass.setQuality(q);
  if (!announce) return;
  const detail = {
    low: 'no post-processing, no shadows, sparse grass',
    medium: 'bloom + colour grade, shadows, normal grass',
    high: 'adds ambient occlusion, dense grass',
  }[q];
  toast.textContent = \`Graphics: \${q.toUpperCase()} - \${detail}\`;
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.style.opacity = '0'), 2200);
};
applyGraphics(false);`,
`// Graphics quality: P cycles low/medium/high
applyGraphics(false, (q) => zoneHost.current.grass.setQuality(q));`
);

// Fix post cycle usage
main = main.replace(
`  if (e.code === 'KeyP' && !e.repeat) {
    post.cycle();
    applyGraphics(true);
  }`,
`  if (e.code === 'KeyP' && !e.repeat) {
    post.cycle();
    applyGraphics(true, (q) => zoneHost.current.grass.setQuality(q));
  }`
);

fs.writeFileSync('src/game/main.ts', main);
console.log('done');
