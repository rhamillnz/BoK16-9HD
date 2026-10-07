import { ActionType, type DialogAction, type DialogTarget } from '../formats/ddx';
import { eventFlagLocation } from '../formats/gam';
import type { ChapterStart } from '../formats/world';
import { applyDialogEffects } from './dialogEffects';
import { scriptedState } from './dialogState';
import { type DialogStore, type SnippetRef, applySetFlag, evaluateChoice, type DialogEnv } from './encounterRunner';
import { activeCharacters, healCharacter, updateCharacter, type PartyState } from './party';
import { startChapter, type WorldState } from './state';
import type { ItemDef } from '../formats/objinfo';
import { applyChapterHandover, type StashSource } from './chapterHandover';

/**
 * Chapter transitions. See docs/formats/chapters.md. A chapter ends when a dialogue sets event
 * pointer 0x7541 or the party clicks a chapter-end hotspot; the finish cutscenes of the old chapter and
 * the intro cutscenes of the next one play, the world is reset for the new chapter and the party
 * lands at the CHAPn.DAT start position.
 */

export const LAST_CHAPTER = 9;


/** Per-encounter "already done" flags: `ENCOUNTER_FLAG_COUNT` bits from this pointer, cleared each chapter. */
export const ENCOUNTER_FLAG_BASE = 0x190;
export const ENCOUNTER_FLAG_COUNT = 0x12c0;

/** Dialogue key of the start-of-chapter action table (its first choice resets flags, its first action pushes the per-chapter table). */
export const START_OF_CHAPTER_KEY = 0x1e8497;
/** Chapter n's map-screen caption is the dialogue at this key plus n - 1. */
export const CHAPTER_START_TEXT_KEY = 0x126;
/** Chapter n's recap (shown from the contents screen) is the dialogue at this key plus n - 1. */
export const CHAPTER_RECAP_KEY = 0x186ab6;

export const chapterStartTextKey = (chapter: number): number => CHAPTER_START_TEXT_KEY + chapter - 1;
export const chapterRecapKey = (chapter: number): number => CHAPTER_RECAP_KEY + chapter - 1;

// ---- World reset -----------------------------------------------------------

/** Clear a run of event flags with one copy of the save bytes. */
export function clearFlags(s: WorldState, base: number, count: number): WorldState {
  const bytes = s.bytes.slice();
  for (let i = 0; i < count; i++) {
    const { byte, bit } = eventFlagLocation(base + i);
    if (byte + 2 > bytes.length) break;
    const word = (bytes[byte]! | (bytes[byte + 1]! << 8)) & ~(1 << bit) & 0xffff;
    bytes[byte] = word & 0xff;
    bytes[byte + 1] = word >> 8;
  }
  return { ...s, bytes };
}

/** True when a dialogue asked for the next chapter (see `applySetFlag`). */
export const transitionRequested = (): boolean => scriptedState.chapterTransition;
export const clearTransitionRequest = (): void => {
  scriptedState.chapterTransition = false;
};

export interface StartActions {
  world: WorldState;
  /** Actions that need the party and items (applied by the caller or `transitionToChapter`). */
  pending: DialogAction[];
  /** TELEPORT.DAT index the chapter's script asks for (a start inside a town or temple), if any. */
  teleport: number | undefined;
  warnings: string[];
}

/**
 * Walk the start-of-chapter script: the root snippet's first choice resets flags; its first action
 * points at a table whose n-th choice is chapter n's script. A script runs its actions, then follows
 * the last of its choices whose condition holds, until a snippet without choices; that one's
 * actions run last.
 */
export function startOfChapterActions(store: DialogStore, world: WorldState, chapter: number, env: DialogEnv = {}): StartActions {
  const out: StartActions = { world, pending: [], teleport: undefined, warnings: [] };
  const root = store.byKey(START_OF_CHAPTER_KEY);
  if (!root) {
    out.warnings.push('start-of-chapter table not found');
    return out;
  }
  const run = (actions: readonly DialogAction[]) => {
    for (const a of actions) {
      if (a.type === ActionType.SetFlag) out.world = applySetFlag(out.world, a);
      else if (a.type === ActionType.Teleport) out.teleport = a.words[0];
      else out.pending.push(a);
    }
  };
  const resolve = (target: DialogTarget | undefined, file: number) => (target ? store.resolve(target, file) : undefined);

  const reset = resolve(root.snippet.choices[0]?.target, root.file);
  if (reset) run(reset.snippet.actions);
  else out.warnings.push('flag reset snippet not found');

  const push = root.snippet.actions.find((a) => a.type === ActionType.PushNextDialog);
  const table = resolve(push?.fields.target as DialogTarget | undefined, root.file);
  const first = resolve(table?.snippet.choices[chapter - 1]?.target, table?.file ?? 0);
  if (!first) {
    out.warnings.push(`no start-of-chapter script for chapter ${chapter}`);
    return out;
  }
  let cur: SnippetRef = first;
  let prev = cur;
  for (let steps = 0; steps < 64; steps++) {
    prev = cur;
    run(cur.snippet.actions);
    let next: SnippetRef = cur;
    for (const c of cur.snippet.choices) {
      if (!evaluateChoice(c, out.world, env)) continue;
      const t = store.resolve(c.target, cur.file);
      if (t) next = t;
    }
    cur = next;
    if (cur.snippet.choices.length === 0) break;
  }
  if (cur !== prev) run(cur.snippet.actions);
  return out;
}

export interface ChapterTransitionInput {
  world: WorldState;
  party: PartyState;
  /** The chapter being entered. */
  chapter: number;
  /** CHAPn.DAT of that chapter. */
  start: ChapterStart;
  store: DialogStore;
  items?: readonly ItemDef[];
  /** Stash chests for the chapter 4 and 5 inventory swaps; without it only money is handed over. */
  containers?: StashSource;
  env?: DialogEnv;
}

export interface ChapterTransitionResult {
  world: WorldState;
  party: PartyState;
  /** TELEPORT.DAT index to visit after arriving at the start position (the chapter opens in a town). */
  teleport: number | undefined;
  /** Where the party stands: the CHAPn.DAT start. */
  start: ChapterStart;
  warnings: string[];
}

/**
 * Enter `chapter`: skip to the next midnight plus the chapter's time change, forget which encounters
 * were done, restore every active character to full health with no conditions, then run the
 * chapter's hand-over of money and inventories (chapterHandover.ts), then the chapter's start script.
 */
export function transitionToChapter(i: ChapterTransitionInput): ChapterTransitionResult {
  let world = startChapter(i.world, i.chapter, i.start.timeElapsed);
  world = clearFlags(world, ENCOUNTER_FLAG_BASE, ENCOUNTER_FLAG_COUNT);
  clearTransitionRequest();

  let party = i.party;
  for (const c of activeCharacters(party)) party = updateCharacter(party, c.index, (x) => healCharacter(x, 100));

  const handover = applyChapterHandover({ world, party, chapter: i.chapter, items: i.items ?? [], containers: i.containers });
  world = handover.world;
  party = handover.party;

  const script = startOfChapterActions(i.store, world, i.chapter, i.env);
  const effects = applyDialogEffects({ world: script.world, party, items: i.items }, script.pending);
  return { world: effects.world, party: effects.party, teleport: script.teleport, start: i.start, warnings: script.warnings };
}
