import { createBrowserSfxPlayer } from './sfx';
import { setSfxHandler } from './sfxBus';
import { isValidSongId } from './music';
import { songFromSoundIndex } from './songs';

/**
 * The only wiring main.ts needs: effects play through the bus, M mutes them with the music. Sound
 * numbers 1002 and up are songs (dialogue stings): they go to `onSong`, which plays the real
 * recording in place of the music, as the original changes the music track for them.
 */
export function installSfx(options: { volume?: number; onSong?: (song: number) => void } = {}): void {
  const player = createBrowserSfxPlayer(options.volume ?? 0.8);
  setSfxHandler((id) => {
    const song = songFromSoundIndex(id);
    if (song !== null && isValidSongId(song) && options.onSong) options.onSong(song);
    else void player.play(id);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) player.toggleMute();
  });
  void player.preload();
}
