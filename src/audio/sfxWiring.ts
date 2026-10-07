import { createBrowserSfxPlayer } from './sfx';
import { setSfxHandler } from './sfxBus';

/** The only wiring main.ts needs: effects play through the bus, M mutes them with the music. */
export function installSfx(options: { volume?: number } = {}): void {
  const player = createBrowserSfxPlayer(options.volume ?? 0.8);
  setSfxHandler((id) => void player.play(id));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) player.toggleMute();
  });
  void player.preload();
}
