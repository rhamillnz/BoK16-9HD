import { describe, expect, it } from 'vitest';
import { cutsceneLabel, songUses } from './musicUsage';
import { EXPLORE_SONGS, SONG_MAIN_MENU, SONG_TITLE } from './songs';

describe('songUses', () => {
  it('names cutscene files by chapter', () => {
    expect(cutsceneLabel('C11.TTM')).toBe('Chapter 1 opening cutscene (C11.TTM)');
    expect(cutsceneLabel('C92.TTM')).toBe('Chapter 9 ending cutscene (C92.TTM)');
    expect(cutsceneLabel('INTRO.TTM')).toBe('Game intro (INTRO.TTM)');
  });

  it('lists every track, with the fixed and remake uses even without data', () => {
    const uses = songUses({ entries: [], get: () => new Uint8Array() });
    expect([...uses.keys()]).toHaveLength(62);
    expect(uses.get(SONG_MAIN_MENU)!.map((u) => u.kind)).toEqual(['fixed', 'remake']);
    expect(uses.get(SONG_TITLE)!.map((u) => u.where)).toEqual(['Remake: title menu']);
    for (const s of EXPLORE_SONGS) expect(uses.get(s)!.some((u) => u.where.includes('rotation'))).toBe(true);
  });

  it('skips files it cannot parse', () => {
    const uses = songUses({ entries: [{ name: 'DIAL_Z01.DDX' }, { name: 'C11.TTM' }], get: () => new Uint8Array([1]) });
    expect(uses.get(3)).toEqual([]);
  });
});
