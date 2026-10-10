/**
 * Song numbers for the original soundtrack. BaKGL addresses songs by a sound
 * index of 1000 + N, and the GOG files music/bakNN.ogg hold the same songs by
 * number N (see songUrl in music.ts).
 *
 * What BaKGL pins down (audio/audio.hpp, gui/mainMenuScreen.hpp, bak/bard.cpp,
 * bak/hotspot.cpp):
 *  - fixed situation songs: main menu 1015, puzzle chest 1003, bard results
 *    1008 (failed), 1040 (poor), 1039 (good), 1007 (best);
 *  - building/temple/inn scenes carry their own song in the GDS hotspot
 *    record (`mSong`, a u16 sound index; 0 = keep the current music).
 * BaKGL has no overworld zone -> song table (it never starts music for the
 * main view), so the per-zone entries below are PROVISIONAL: edit ZONE_SONGS
 * after listening. `?song=N` in the URL overrides the zone song for testing.
 */

export const SOUND_INDEX_BASE = 1000;

export const SONG_MAIN_MENU = 15;
export const SONG_PUZZLE_CHEST = 3;
export const SONG_BARD_FAILED = 8;
export const SONG_BARD_POOR = 40;
export const SONG_BARD_GOOD = 39;
export const SONG_BARD_BEST = 7;

/**
 * Songs the dialogues play as cues (PlaySound 1000 + N in DIAL_Z*.DDX; song 2 alone is used 44 times,
 * e.g. after the first talk with Gorath). They play once over the music, so exploring must use another.
 */
export const DIALOGUE_SONGS: readonly number[] = [
  1, 2, 3, 4, 6, 7, 11, 12, 13, 14, 17, 18, 19, 24, 25, 28, 29, 30, 32, 34, 36, 37, 38, 39, 41, 42, 43, 44, 46, 47, 48,
  49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
];

/** Song used for exploring when a zone has no entry of its own (provisional): a long track no dialogue uses. */
export const DEFAULT_ZONE_SONG = 22;

/** Zone number -> song number. Provisional: BaKGL does not document this. */
export const ZONE_SONGS: Readonly<Record<number, number>> = {};

/** Convert a BaKGL sound index (1001..1063) to a song number, or null if it is not a song. */
export function songFromSoundIndex(soundIndex: number): number | null {
  const n = soundIndex - SOUND_INDEX_BASE;
  return Number.isInteger(n) && n >= 1 && n <= 63 ? n : null;
}

/** Song to play while exploring a zone. */
export function songForZone(zone: number): number {
  return ZONE_SONGS[zone] ?? DEFAULT_ZONE_SONG;
}

/** Song for a bard performance outcome. */
export function songForBard(outcome: 'failed' | 'poor' | 'good' | 'best'): number {
  switch (outcome) {
    case 'failed':
      return SONG_BARD_FAILED;
    case 'poor':
      return SONG_BARD_POOR;
    case 'good':
      return SONG_BARD_GOOD;
    case 'best':
      return SONG_BARD_BEST;
  }
}
