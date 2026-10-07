import { parseDDX, type DialogFile } from '../formats/ddx';
import type { HudScreens } from '../ui/hud';
import '../ui/cutsceneScreen'; // registers the cutscene screen
import { DIALOG_FILE_COUNT, dialogFileName } from './encounterDriver';
import { DialogStore } from './encounterRunner';
import { chapterFinishCutscenes, chapterStartCutscenes, cutsceneDialogKey, loadCutscene, type CutsceneHost, type CutsceneStep } from './cutscene';
import { SCENE_HEIGHT, SCENE_WIDTH, type FetchResources } from './townScene';

/** Book chapter file of a TTM dialogue type 2 key: `C` and the key as two digits. */
export const bookFile = (key: number): string => `C${String(key % 100).padStart(2, '0')}.BOK`;

/** What cutscenes need from the running game. */
export interface CutsceneControlsHost {
  fetch: FetchResources;
  hud: HudScreens;
  chapter(): number;
  /** A sound effect, or a music track from 255 up. */
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
        try { if (bytes) files.set(n, parseDDX(bytes)); } catch { /* skip an unreadable file */ }
      }
      return new DialogStore(files);
    });
    return dialogs;
  };

  const play = async (ads: string, ttm: string): Promise<void> => {
    if (active) return;
    const store = await loadDialogs().catch(() => undefined);
    const hooks: CutsceneHost = {
      text: (n) => store?.byKey(cutsceneDialogKey(n))?.snippet.text,
      sound: host.sound,
      book: host.playBook && ((key, done) => void host.playBook!(bookFile(key)).then(done)),
      dialog: host.dialog && ((key, done) => void host.dialog!(cutsceneDialogKey(key)).then(done)),
    };
    let player;
    try {
      player = await loadCutscene(host.fetch, ads, ttm, { chapter: host.chapter(), host: hooks });
    } catch (err) {
      console.warn('Cutscene unavailable:', err);
      return;
    }
    active = true;
    await new Promise<void>((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = SCENE_WIDTH;
      canvas.height = SCENE_HEIGHT;
      let last = performance.now();
      let raf = 0;
      let shown: Uint8ClampedArray | undefined;
      const tick = (now: number) => {
        player.update(Math.min(100, now - last));
        last = now;
        if (player.take()) host.hud.invalidate();
        if (!player.finished) raf = requestAnimationFrame(tick);
      };
      player.start(() => {
        cancelAnimationFrame(raf);
        host.hud.end('cutscene');
        resolve();
      });
      if (player.finished) return;
      host.hud.open('cutscene', {
        player,
        picture: () => {
          if (!player.image) return undefined;
          if (shown !== player.image) {
            shown = player.image;
            canvas.getContext('2d')!.putImageData(new ImageData(player.image as Uint8ClampedArray<ArrayBuffer>, SCENE_WIDTH, SCENE_HEIGHT), 0, 0);
          }
          return canvas;
        },
      });
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

  const api: Cutscenes = {
    play,
    playSteps,
    playChapterStart: (chapter = host.chapter()) => playSteps(chapterStartCutscenes(chapter)),
    playChapterFinish: (chapter = host.chapter()) => playSteps(chapterFinishCutscenes(chapter)),
    get active() {
      return active;
    },
  };

  const q = new URLSearchParams(location.search).get('cutscene');
  if (q) {
    const [ads, ttm] = q.split(',');
    if (ads && ttm) void play(ads, ttm);
  }
  return api;
}

