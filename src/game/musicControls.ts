import { WeatherAmbience } from '../audio/ambience';
import { createBrowserMusicPlayer } from '../audio/music';
import { COMBAT_SONGS, EXPLORE_SONGS, UNDERGROUND_SONGS, ZONE_SONGS } from '../audio/songs';
import { isUndergroundZone } from '../world/underground';
import { DEFAULT_SETTINGS } from './mainMenu';

const warn = (err: unknown) => console.warn('Music unavailable:', err);

/**
 * Music and weather ambience: the zone's exploring music, fight music while a combat is on, and M to mute both.
 * The player resumes on the first gesture; `?song=N` overrides the zone song.
 */
export function installMusic(firstZone: number) {
  const music = createBrowserMusicPlayer({ volume: DEFAULT_SETTINGS.volume });
  const ambience = new WeatherAmbience(); // synthesised rain and wind, scaled by the weather

  /** Exploring music: `?song=N` loops file N, a zone with its own song loops that, otherwise the rotation. */
  const zoneMusic = (zone: number): void => {
    const forced = new URLSearchParams(location.search).get('song');
    const own = forced !== null ? Number(forced) : ZONE_SONGS[zone];
    const started =
      own !== undefined
        ? music.play(own)
        : music.playRotation(
            isUndergroundZone(zone) ? UNDERGROUND_SONGS : EXPLORE_SONGS,
            Math.floor(Math.random() * EXPLORE_SONGS.length),
          );
    void started.catch(warn);
  };

  /** Whether the fight music is on; the frame loop switches it with `combat.active`. */
  let combatMusic = false;
  const updateCombatMusic = (active: boolean, zone: number): void => {
    if (active === combatMusic) return;
    combatMusic = active;
    if (!active) return zoneMusic(zone);
    const song = COMBAT_SONGS[Math.floor(Math.random() * COMBAT_SONGS.length)]!;
    void music.play(song).catch(warn);
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) {
      music.toggleMute();
      ambience.setMuted(music.isMuted);
    }
  });
  zoneMusic(firstZone);
  return { music, ambience, zoneMusic, updateCombatMusic };
}
