import type { ChapterStart } from '../formats/world';
import type { ItemDef } from '../formats/objinfo';
import {
  LAST_CHAPTER,
  chapterStartTextKey,
  clearTransitionRequest,
  transitionRequested,
  transitionToChapter,
} from './chapters';
import { parseDDX, type DialogFile } from '../formats/ddx';
import { DIALOG_FILE_COUNT, dialogFileName, type ReadResource } from './encounterDriver';
import { DialogStore } from './encounterRunner';
import type { PartyState } from './party';
import type { WorldState } from './state';

/** What chapter transitions need from the running game. */
export interface ChapterHost {
  items: readonly ItemDef[];
  getParty(): PartyState;
  setParty(p: PartyState): void;
  getWorld(): WorldState;
  setWorld(w: WorldState): void;
  /** CHAPn.DAT start of `chapter`. */
  loadStart(chapter: number): ChapterStart;
  /** The dialogue files (and keyword table) the start-of-chapter script lives in. */
  loadStore(): Promise<DialogStore>;
  /** Play the ending of chapter `from`, then the intro of chapter `to`. Leave unset to skip the scenes. */
  playCutscenes?(from: number, to: number): Promise<void>;
  /** Show the dialogue at `key` (the chapter's map caption) and resolve when it is dismissed. */
  showText(key: number): Promise<void>;
  /**
   * The chapter changed: the world and party are already stored. Reload encounters for the new
   * chapter and place the party; `teleport` is a TELEPORT.DAT index to visit after arriving.
   */
  arrive(start: ChapterStart, teleport: number | undefined): Promise<void>;
  /** The new chapter's start-of-chapter script and flag reset are done: refresh the sky and HUD. */
  onTransitioned?(chapter: number): void;
}

export interface ChapterControls {
  /** Leave the current chapter for `chapter` (default: the next one). Resolves false when there is none or one is running. */
  begin(chapter?: number, opts?: { cutscenes?: boolean }): Promise<boolean>;
  /** Call after a dialogue ends: starts the next chapter if the dialogue asked for it. */
  afterDialog(): Promise<boolean>;
  readonly busy: boolean;
}

/** Wire chapter transitions: one call with the host, then `afterDialog()` where dialogues end. */
export function installChapters(host: ChapterHost): ChapterControls {
  let busy = false;

  const begin = async (target?: number, opts: { cutscenes?: boolean } = {}): Promise<boolean> => {
    const from = host.getWorld().chapter;
    const chapter = target ?? from + 1;
    if (busy || chapter < 1 || chapter > LAST_CHAPTER) return false;
    busy = true;
    try {
      if (opts.cutscenes !== false && host.playCutscenes) await host.playCutscenes(chapter - 1, chapter);
      const store = await host.loadStore();
      const start = host.loadStart(chapter);
      const result = transitionToChapter({
        world: host.getWorld(), party: host.getParty(), chapter, start, store, items: host.items,
      });
      for (const w of result.warnings) console.warn('chapter transition:', w);
      host.setWorld(result.world);
      host.setParty(result.party);
      host.onTransitioned?.(chapter);
      await host.showText(chapterStartTextKey(chapter));
      await host.arrive(start, result.teleport);
      return true;
    } finally {
      busy = false;
    }
  };

  return {
    begin,
    async afterDialog() {
      if (busy || !transitionRequested()) return false;
      clearTransitionRequest();
      return begin();
    },
    get busy() {
      return busy;
    },
  };
}

/** Build the dialogue store from already fetched resources (see `prefetchResources`). */
export function loadDialogStore(read: ReadResource): DialogStore {
  const files = new Map<number, DialogFile>();
  for (let n = 0; n < DIALOG_FILE_COUNT; n++) {
    const bytes = read(dialogFileName(n));
    if (bytes) files.set(n, parseDDX(bytes));
  }
  return new DialogStore(files);
}
