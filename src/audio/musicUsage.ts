import { ActionType, parseDDX } from '../formats/ddx';
import { parseGds } from '../formats/gds';
import { parseTtmFrames } from '../formats/ttm';
import { MAX_SONG_ID, MIN_SONG_ID } from './music';
import {
  EXPLORE_SONGS,
  SONG_BARD_BEST,
  SONG_BARD_FAILED,
  SONG_BARD_GOOD,
  SONG_BARD_POOR,
  SONG_MAIN_MENU,
  SONG_PUZZLE_CHEST,
  SONG_TITLE,
  songFromSoundIndex,
} from './songs';

/** One place a song is played, for the music browser (music.html). */
export interface SongUse {
  kind: 'dialogue' | 'cutscene' | 'scene' | 'fixed' | 'remake';
  /** Where: a file name, or what the fixed use is. */
  where: string;
  /** Dialogue text where the cue fires, or a longer explanation. */
  detail?: string;
}

/** Read-only view of the game archive (ResourceArchive fits). */
export interface ArchiveLike {
  readonly entries: readonly { name: string }[];
  get(name: string): Uint8Array;
}

/** What a cutscene file is: C11.TTM is chapter 1's opening, C12.TTM its ending. */
export function cutsceneLabel(name: string): string {
  const m = /^C(\d)(\d)\.TTM$/i.exec(name);
  if (m) return `Chapter ${m[1]} ${m[2] === '1' ? 'opening' : 'ending'} cutscene (${name})`;
  if (/^INTRO\.TTM$/i.test(name)) return 'Game intro (INTRO.TTM)';
  return `Cutscene ${name}`;
}

const FIXED: [number, string][] = [
  [SONG_MAIN_MENU, 'Original main menu (BaKGL mainMenuScreen)'],
  [SONG_PUZZLE_CHEST, 'Puzzle chest (word lock) screen'],
  [SONG_BARD_FAILED, 'Bard performance: failed'],
  [SONG_BARD_POOR, 'Bard performance: poor'],
  [SONG_BARD_GOOD, 'Bard performance: good'],
  [SONG_BARD_BEST, 'Bard performance: best'],
];

/**
 * Every use of every song (bak02..bak63) the data and BaKGL show: dialogue cues (PlaySound in the
 * DDX files), cutscene music changes (TTM sound ops), building scenes (GDS song), the fixed
 * situations BaKGL names, and what this remake does with it.
 */
export function songUses(archive: ArchiveLike): Map<number, SongUse[]> {
  const uses = new Map<number, SongUse[]>();
  for (let n = MIN_SONG_ID; n <= MAX_SONG_ID; n++) uses.set(n, []);
  const add = (song: number | null, use: SongUse) => {
    if (song !== null) uses.get(song)?.push(use);
  };

  for (const { name } of archive.entries) {
    try {
      if (/^DIAL_Z\d\d\.DDX$/i.test(name)) {
        for (const s of parseDDX(archive.get(name)).snippets)
          for (const a of s.actions)
            if (a.type === ActionType.PlaySound)
              add(songFromSoundIndex(a.words[0]!), {
                kind: 'dialogue',
                where: name,
                detail: s.text.replace(/\s+/g, ' ').trim().slice(0, 140) || undefined,
              });
      } else if (/\.TTM$/i.test(name)) {
        const seen = new Set<number>();
        for (const f of parseTtmFrames(archive.get(name)))
          for (const o of f.ops)
            if (o.op === 'sound') {
              const song = songFromSoundIndex(o.index);
              if (song !== null && !seen.has(song)) {
                seen.add(song);
                add(song, { kind: 'cutscene', where: cutsceneLabel(name) });
              }
            }
      } else if (/\.GDS$/i.test(name)) {
        add(songFromSoundIndex(parseGds(archive.get(name)).song), { kind: 'scene', where: `Building scene ${name}` });
      }
    } catch {
      // an unreadable file adds nothing
    }
  }

  for (const [song, what] of FIXED) add(song, { kind: 'fixed', where: what });
  add(SONG_TITLE, { kind: 'remake', where: 'Remake: title menu' });
  for (const song of EXPLORE_SONGS) add(song, { kind: 'remake', where: 'Remake: exploring rotation' });
  return uses;
}
