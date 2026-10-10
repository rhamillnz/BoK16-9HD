/**
 * Song numbers for the original soundtrack. A song number here is the number of its GOG file,
 * music/bakNN.ogg (see songUrl in music.ts). The game data addresses songs by a sound index of
 * 1000 + N, and that song is in file N + 1: matching the MIDI lengths in FRP.SX against the OGG
 * lengths shows the offset (the run of very short sounds 1046-1055 is in bak47-bak56, sound 1009
 * in bak10, 1035 in bak36, 1059 in bak60), and there are 62 of each.
 *
 * What BaKGL pins down by sound index (audio/audio.hpp, gui/mainMenuScreen.hpp, bak/bard.cpp,
 * bak/hotspot.cpp):
 *  - fixed situation songs: main menu 1015, puzzle chest 1003, bard results
 *    1008 (failed), 1040 (poor), 1039 (good), 1007 (best);
 *  - building/temple/inn scenes carry their own song in the GDS hotspot
 *    record (`mSong`, a u16 sound index; 0 = keep the current music).
 * BaKGL has no overworld zone -> song table (it never starts music for the
 * main view), so exploring rotates through the songs nothing else uses
 * (EXPLORE_SONGS). `?song=N` in the URL plays file N on a loop instead.
 */

export const SOUND_INDEX_BASE = 1000;

export const SONG_MAIN_MENU = 16;
/** Our title menu's song: SARTH (file 22), chosen by ear (2026-10-11); the original's menu plays MAINMENU (16). */
export const SONG_TITLE = 22;
export const SONG_PUZZLE_CHEST = 4;
export const SONG_BARD_FAILED = 9;
export const SONG_BARD_POOR = 41;
export const SONG_BARD_GOOD = 40;
export const SONG_BARD_BEST = 8;

/**
 * Songs the dialogues play as cues (PlaySound 1000 + N in DIAL_Z*.DDX, here as file numbers). File 3
 * (sound 1002) alone is used 44 times, e.g. the dread after burying the body with Gorath.
 */
export const DIALOGUE_SONGS: readonly number[] = [
  2, 3, 4, 5, 7, 8, 12, 13, 14, 15, 18, 19, 20, 25, 26, 29, 30, 31, 33, 35, 37, 38, 39, 40, 42, 43, 44, 45, 47, 48, 49,
  50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
];

/** Songs the chapter cutscenes play (TTM sound 1000 + N; file 22 is in the chapter 9 cutscene C92). */
export const CUTSCENE_SONGS: readonly number[] = [
  2, 10, 11, 19, 20, 21, 22, 24, 26, 31, 32, 36, 37, 43, 45, 46, 58, 61,
];

/**
 * Exploring music. FRP.SX names every song; the original's exploring themes are EXPABOV1 (file 2) and
 * EXPABOV2 (file 62), "exploring above ground" (EXPUNDRG, file 5, is the underground one). They play
 * one after another, each once. Other names: MDSERIUS (3, the serious mood cue), MAINMENU (16),
 * COMBAT/COMBAT3M/COMBAT4/SLOBATLE (35, 31, 6, 7), town and place themes such as KRONDOR (14).
 */
export const EXPLORE_SONGS: readonly number[] = [2, 62];

/** Song used for exploring a zone with no rotation (the first of EXPLORE_SONGS). */
export const DEFAULT_ZONE_SONG = EXPLORE_SONGS[0]!;

/** Zone number -> song number, for a zone that should keep one song instead of the rotation. */
export const ZONE_SONGS: Readonly<Record<number, number>> = {};

/** Convert a sound index (1001..1062) to a song (file) number, or null if it is not a song. */
export function songFromSoundIndex(soundIndex: number): number | null {
  const n = soundIndex - SOUND_INDEX_BASE;
  return Number.isInteger(n) && n >= 1 && n <= 62 ? n + 1 : null;
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
