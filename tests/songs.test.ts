import { describe, expect, it } from 'vitest';
import { isValidSongId } from '../src/audio/music';
import {
  DEFAULT_ZONE_SONG,
  CUTSCENE_SONGS,
  DIALOGUE_SONGS,
  EXPLORE_SONGS,
  SONG_TITLE,
  SONG_BARD_BEST,
  SONG_MAIN_MENU,
  SONG_PUZZLE_CHEST,
  ZONE_SONGS,
  songForBard,
  songForZone,
  songFromSoundIndex,
} from '../src/audio/songs';

describe('songs', () => {
  it('converts BaKGL sound indices to song numbers', () => {
    expect(songFromSoundIndex(1015)).toBe(SONG_MAIN_MENU);
    expect(songFromSoundIndex(1003)).toBe(SONG_PUZZLE_CHEST);
    expect(songFromSoundIndex(1007)).toBe(SONG_BARD_BEST);
    expect(songFromSoundIndex(0)).toBeNull();
    expect(songFromSoundIndex(1000)).toBeNull();
    expect(songFromSoundIndex(1063)).toBeNull();
    // Sound 1002, the dialogue's dread cue, is in bak03.ogg.
    expect(songFromSoundIndex(1002)).toBe(3);
    expect(songFromSoundIndex(1062)).toBe(63);
  });

  it('maps bard outcomes to the BaKGL songs', () => {
    expect([songForBard('failed'), songForBard('poor'), songForBard('good'), songForBard('best')]).toEqual([
      9, 41, 40, 8,
    ]);
  });

  it('falls back to the default for unmapped zones', () => {
    expect(songForZone(9999)).toBe(DEFAULT_ZONE_SONG);
  });

  it('only uses playable song ids', () => {
    expect(isValidSongId(DEFAULT_ZONE_SONG)).toBe(true);
    // A cue that is already the music would not be heard, so exploring keeps clear of them all.
    for (const id of EXPLORE_SONGS) {
      expect(isValidSongId(id)).toBe(true);
      expect(DIALOGUE_SONGS).not.toContain(id);
      expect(CUTSCENE_SONGS).not.toContain(id);
      expect([SONG_TITLE, SONG_MAIN_MENU, SONG_PUZZLE_CHEST, 8, 9, 40, 41]).not.toContain(id);
    }
    for (const id of Object.values(ZONE_SONGS)) expect(isValidSongId(id)).toBe(true);
    for (const id of [SONG_MAIN_MENU, SONG_PUZZLE_CHEST, 8, 9, 40, 41]) expect(isValidSongId(id)).toBe(true);
  });
});
