import { parseDDX, type DialogFile } from '../formats/ddx';
import { hdUrl } from './cutsceneHd';
import type { HdPicture } from './cutsceneHdRenderer';
import type { HudScreens } from '../ui/hud';
import '../ui/cutsceneScreen'; // registers the cutscene screen
import type { CutsceneScreenView } from '../ui/cutsceneScreen';
import { playSfx } from '../audio/sfxBus';
import { DIALOG_FILE_COUNT, dialogFileName } from './encounterDriver';
import { DialogStore } from './encounterRunner';
import { songFromSoundIndex } from '../audio/songs';
import type { MusicPlayer } from '../audio/music';
import {
  chapterFinishCutscenes,
  chapterStartCutscenes,
  introCutscenes,
  cutsceneDialogKey,
  loadCutscene,
  type CutsceneHost,
  type CutscenePlayer,
  type CutsceneStep,
} from './cutscene';
import { SCENE_HEIGHT, SCENE_WIDTH, type FetchResources } from './townScene';

/** Book chapter file of a TTM dialogue type 2 key: `C` and the key as two digits. */
export const bookFile = (key: number): string => `C${String(key % 100).padStart(2, '0')}.BOK`;

/**
 * Music changes of one cutscene: sound indexes of 255 and up name a song (1000 + song). The song playing before the
 * first change is brought back by `restore` when the cutscene ends (silence if none was playing).
 */
export function cutsceneMusic(
  music:
    | (Pick<MusicPlayer, 'play' | 'stop' | 'songId'> & Partial<Pick<MusicPlayer, 'rotating' | 'resumeRotation'>>)
    | undefined,
): {
  change(index: number): void;
  restore(): void;
} {
  let before: number | 'rotation' | null | undefined;
  return {
    change(index) {
      const song = songFromSoundIndex(index);
      if (song === null || !music) return;
      if (before === undefined) before = music.rotating ? 'rotation' : music.songId;
      void music.play(song).catch((err) => console.warn('Cutscene music unavailable:', err));
    },
    restore() {
      if (before === undefined || !music) return;
      if (before === null) music.stop();
      else if (before === 'rotation') void music.resumeRotation?.().catch(() => undefined);
      else void music.play(before).catch(() => undefined);
      before = undefined;
    },
  };
}

/** What cutscenes need from the running game. */
export interface CutsceneControlsHost {
  fetch: FetchResources;
  hud: HudScreens;
  chapter(): number;
  /** Where music changes of a cutscene (sound index 255 and up, 1000 + song) play; the previous song returns at its end. */
  music?: Pick<MusicPlayer, 'play' | 'stop' | 'songId'> & Partial<Pick<MusicPlayer, 'rotating' | 'resumeRotation'>>;
  /** A sound effect, or a music track from 255 up. Defaults to the sound-effect bus for effects and `music` for tracks. */
  sound?(index: number): void;
  /** Run a full dialogue; resolve when it ends. */
  dialog?(key: number): Promise<void>;
  /** Show a book chapter (`C11.BOK`); resolve when it is read. Book steps are skipped without it. */
  playBook?(file: string): Promise<void>;
}

export interface Cutscenes {
  /** Play one ADS/TTM animation full screen; resolves when it ends or is skipped. Resolves at once when its files are missing. */
  play(ads: string, ttm: string): Promise<void>;
  /** Play a list of steps in order (see `chapterStartCutscenes`). */
  playSteps(steps: readonly CutsceneStep[]): Promise<void>;
  playChapterStart(chapter?: number): Promise<void>;
  playChapterFinish(chapter?: number): Promise<void>;
  /** The new-game opening (`introCutscenes`). Escape skips a scene; Escape twice within a second skips the rest. */
  /** The opening: the title animation then the story (`storyOnly`: just chapter 1's card, book and first scene). */
  playIntro(storyOnly?: boolean): Promise<void>;
  readonly active: boolean;
}

/**
 * Cutscene playback: `play` opens the registered 'cutscene' screen and drives the player with the animation
 * clock. Also runnable from the URL with `?cutscene=ADSNAME,TTMNAME` (e.g. `?cutscene=CHAPTER1.ADS,CHAPTER1.TTM`).
 */
export function installCutscenes(host: CutsceneControlsHost): Cutscenes {
  let active = false;
  let dialogs: Promise<DialogStore> | undefined;
  /** The dialogue files, read once, for the cutscene text keys. */
  const loadDialogs = (): Promise<DialogStore> => {
    dialogs ??= host.fetch(Array.from({ length: DIALOG_FILE_COUNT }, (_, n) => dialogFileName(n))).then((read) => {
      const files = new Map<number, DialogFile>();
      for (let n = 0; n < DIALOG_FILE_COUNT; n++) {
        const bytes = read(dialogFileName(n));
        try {
          if (bytes) files.set(n, parseDDX(bytes));
        } catch {
          /* skip an unreadable file */
        }
      }
      return new DialogStore(files);
    });
    return dialogs;
  };

  const play = async (ads: string, ttm: string): Promise<void> => {
    if (active) return;
    const store = await loadDialogs().catch(() => undefined);
    let view: CutsceneScreenView | undefined;
    let player: CutscenePlayer | undefined;
    /** A book or dialogue took the screen: put the cutscene back when it ends. */
    const reopen = () => {
      if (view && player && !player.finished) host.hud.open('cutscene', view);
    };
    const resume = (done: () => void) => () => {
      reopen();
      done();
    };
    const music = cutsceneMusic(host.music);
    const hooks: CutsceneHost = {
      text: (n) => store?.byKey(cutsceneDialogKey(n))?.snippet.text,
      sound:
        host.sound ??
        ((i) => {
          if (i < 255) playSfx(i);
          else music.change(i);
        }),
      book: host.playBook && ((key, done) => void host.playBook!(bookFile(key)).then(resume(done))),
      dialog: host.dialog && ((key, done) => void host.dialog!(cutsceneDialogKey(key)).then(resume(done))),
    };
    try {
      player = await loadCutscene(host.fetch, ads, ttm, {
        chapter: host.chapter(),
        host: hooks,
        loadHd: loadHdPictures,
      });
    } catch (err) {
      console.warn('Cutscene unavailable:', err);
      return;
    }
    const pl: CutscenePlayer = player;
    active = true;
    await new Promise<void>((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = SCENE_WIDTH;
      canvas.height = SCENE_HEIGHT;
      let last = performance.now();
      let raf = 0;
      let shown: Uint8ClampedArray | undefined;
      const tick = (now: number) => {
        pl.update(Math.min(100, now - last));
        last = now;
        if (pl.take()) host.hud.invalidate();
        if (!pl.finished) raf = requestAnimationFrame(tick);
      };
      pl.start(() => {
        cancelAnimationFrame(raf);
        host.hud.end('cutscene');
        music.restore();
        resolve();
      });
      if (pl.finished) return;
      view = {
        player: pl,
        picture: () => {
          if (pl.hdImage) return pl.hdImage;
          if (!pl.image) return undefined;
          if (shown !== pl.image) {
            shown = pl.image;
            canvas
              .getContext('2d')!
              .putImageData(new ImageData(pl.image as Uint8ClampedArray<ArrayBuffer>, SCENE_WIDTH, SCENE_HEIGHT), 0, 0);
          }
          return canvas;
        },
      };
      host.hud.open('cutscene', view);
      raf = requestAnimationFrame(tick);
    });
    active = false;
  };

  const playSteps = async (steps: readonly CutsceneStep[]): Promise<void> => {
    for (const step of steps) {
      if (step.kind === 'ttm') await play(step.ads, step.ttm);
      else await host.playBook?.(step.file);
    }
  };

  // True for the whole intro, including the loading gaps between its scenes (Escape must not open the menu there).
  let inIntro = false;
  const playIntro = async (storyOnly = false): Promise<void> => {
    let lastEscape = -Infinity;
    let skipAll = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || e.repeat) return;
      if (e.timeStamp - lastEscape < 1000) skipAll = true;
      lastEscape = e.timeStamp;
    };
    window.addEventListener('keydown', onKey, true);
    inIntro = true;
    try {
      for (const step of storyOnly ? chapterStartCutscenes(1) : introCutscenes()) {
        if (skipAll) break;
        await playSteps([step]);
      }
    } finally {
      inIntro = false;
      window.removeEventListener('keydown', onKey, true);
    }
  };

  const api: Cutscenes = {
    play,
    playSteps,
    playChapterStart: (chapter = host.chapter()) => playSteps(chapterStartCutscenes(chapter)),
    playChapterFinish: (chapter = host.chapter()) => playSteps(chapterFinishCutscenes(chapter)),
    playIntro,
    get active() {
      return active || inIntro;
    },
  };

  const q = new URLSearchParams(location.search).get('cutscene');
  if (q) {
    const [ads, ttm] = q.split(',');
    if (ads && ttm) void play(ads, ttm);
  }
  return api;
}

/** The upscaled cutscene pictures that exist for these stems (served from /art/cutscenes-4x/ in dev). */
async function loadHdPictures(stems: readonly string[]): Promise<ReadonlyMap<string, HdPicture>> {
  const found = new Map<string, HdPicture>();
  await Promise.all(
    stems.map(async (stem) => {
      const img = new Image();
      img.src = hdUrl(stem);
      try {
        await img.decode();
        found.set(stem, img);
      } catch {
        // not upscaled: the original picture is drawn instead
      }
    }),
  );
  return found;
}
