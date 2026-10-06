import { describe, expect, it } from 'vitest';
import { isValidSongId } from '../src/audio/music';
import {
  DEFAULT_ZONE_SONG,
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
    expect(songFromSoundIndex(1064)).toBeNull();
  });

  it('maps bard outcomes to the BaKGL songs', () => {
    expect([songForBard('failed'), songForBard('poor'), songForBard('good'), songForBard('best')]).toEqual([8, 40, 39, 7]);
  });

  it('falls back to the default for unmapped zones', () => {
    expect(songForZone(9999)).toBe(DEFAULT_ZONE_SONG);
  });

  it('only uses playable song ids', () => {
    expect(isValidSongId(DEFAULT_ZONE_SONG)).toBe(true);
    for (const id of Object.values(ZONE_SONGS)) expect(isValidSongId(id)).toBe(true);
    for (const id of [SONG_MAIN_MENU, SONG_PUZZLE_CHEST, 7, 8, 39, 40]) expect(isValidSongId(id)).toBe(true);
  });
});
