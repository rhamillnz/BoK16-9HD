import { createBrowserMusicPlayer } from '../../audio/music';
import { songForZone } from '../../audio/songs';
import { installSfx } from '../../audio/sfxWiring';

export function setupAudio(zoneNumber: number) {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  
  const music = createBrowserMusicPlayer({ volume: 0.7 });
  void music.play(num('song', songForZone(zoneNumber))).catch((err) => console.warn('Music unavailable:', err));
  
  installSfx();

  return { music };
}
