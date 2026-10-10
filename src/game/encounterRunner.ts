import {
  ActionType,
  snippetForKey,
  type DialogAction,
  type DialogChoice,
  type DialogFile,
  type DialogSnippet,
  type DialogTarget,
} from '../formats/ddx';
import { EncounterType, type EncounterRecord } from '../formats/encounters';
import { eventFlagLocation } from '../formats/gam';
import type { TownEntry } from '../formats/gds';
import { Reader } from '../formats/reader';
import { isEncounterActive, type EncounterMap, type PlacedEncounter } from '../world/encounters';
import { getFlag, hourOfDay, setFlag, type WorldState } from './state';
import { GAME_STATE_CHAPTER_TRANSITION, scriptedState } from './dialogState';
import { resolveSpeaker, type Speaker } from './speaker';
import { TextVariables, type TextVariableContext } from './textVariables';
import type { ZoneTransition } from './transitions';

/**
 * Runs tile encounters and the dialogue they point at. See docs/formats/dialogue.md section 7.
 *
 * The state machine follows how the original runs a conversation: a stack of pending targets, a
 * current snippet whose actions run when it is entered, and choices that push their target.
 * All world changes go through the immutable `WorldState`; effects on characters, items and the
 * party are not applied here, they are reported in `DialogSession.pendingActions`.
 */

// ---- Definition files ------------------------------------------------------

/**
 * DEF_DIAL.DAT and DEF_BLOC.DAT: u32 count, then count records of 9 bytes
 * (3 unknown bytes, u32 dialogue key, u16 unknown). The encounter's `tableIndex` selects the record.
 */
export const DEF_DIALOG_RECORD_SIZE = 9;

export function parseDefDialog(bytes: Uint8Array): number[] {
  const r = new Reader(bytes);
  const count = Math.min(r.u32(), Math.floor((bytes.length - 4) / DEF_DIALOG_RECORD_SIZE));
  const keys: number[] = [];
  for (let i = 0; i < count; i++) {
    r.skip(3);
    keys.push(r.u32());
    r.skip(2);
  }
  return keys;
}

/**
 * KEYWORD.DAT: u16 length, then u16 string offsets up to file offset 0x2b8, then NUL-terminated
 * strings. Indices below 0xAC are conversation topics (the event pointer); 0x100+ are query labels.
 */
export const KEYWORD_TABLE_END = 0x2b8;

export function parseKeywords(bytes: Uint8Array): string[] {
  const r = new Reader(bytes, 2);
  const offsets: number[] = [];
  while (r.pos < KEYWORD_TABLE_END && r.pos + 2 <= bytes.length) offsets.push(r.u16());
  return offsets.map((offset) => {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0) end++;
    return String.fromCharCode(...bytes.subarray(offset, end));
  });
}

export const QUERY_YES = 0x100;
export const QUERY_NO = 0x101;
/** Fallback labels for query choices when KEYWORD.DAT is unavailable. */
const QUERY_LABELS = new Map<number, string>([
  [0x100, 'Yes'],
  [0x101, 'No'],
  [0x104, 'Accept'],
  [0x105, 'Decline'],
  [0x106, 'Haggle'],
]);

// ---- Dialogue store --------------------------------------------------------

export interface SnippetRef {
  file: number;
  snippet: DialogSnippet;
}

/** All DIAL_Zxx.DDX files together: keys are global, offsets are per file. */
export class DialogStore {
  private readonly files: Map<number, DialogFile>;
  private readonly keyFile = new Map<number, number>();

  /** `files` maps the file number (zone) to its parsed DDX. The lowest file wins duplicate keys. */
  constructor(files: Map<number, DialogFile>) {
    this.files = files;
    for (const num of [...files.keys()].sort((a, b) => a - b)) {
      for (const key of files.get(num)!.index.keys()) if (!this.keyFile.has(key)) this.keyFile.set(key, num);
    }
  }

  byKey(key: number): SnippetRef | undefined {
    const file = this.keyFile.get(key);
    if (file === undefined) return undefined;
    const snippet = snippetForKey(this.files.get(file)!, key);
    return snippet && { file, snippet };
  }

  byOffset(file: number, offset: number): SnippetRef | undefined {
    const snippet = this.files.get(file)?.byOffset.get(offset);
    return snippet && { file, snippet };
  }

  /** Key targets are global; offset targets stay in the file of the snippet that holds them. */
  resolve(target: DialogTarget, fromFile: number): SnippetRef | undefined {
    if (target.kind === 'none') return undefined;
    return target.kind === 'key' ? this.byKey(target.key) : this.byOffset(fromFile, target.offset);
  }
}

// ---- Event flag helpers ----------------------------------------------------

/** Conversation topics already picked are marked from this event pointer base plus the topic. */
const CONVERSATION_CHOICE_MARKED = 0x1d4c;
/** Conversation topics switched off permanently. */
const CONVERSATION_OPTION_INHIBITED = 0x1a2c;
/** Per-encounter "already encountered this chapter" flags: base 0x190, 0x190 per zone, 10 per tile. */
const ENCOUNTER_STATE_OFFSET = 0x190;
const MAX_ENCOUNTERS_PER_TILE = 10;
const COMPLEX_EVENT_THRESHOLD = 0xdac0;

export function uniqueEncounterFlag(zone: number, tileIndex: number, encounterIndex: number): number {
  return (
    (zone - 1) * ENCOUNTER_STATE_OFFSET + tileIndex * MAX_ENCOUNTERS_PER_TILE + encounterIndex + ENCOUNTER_STATE_OFFSET
  );
}

function readBits(s: WorldState, ptr: number): number {
  const { byte, bit } = eventFlagLocation(ptr);
  return ((s.bytes[byte]! | (s.bytes[byte + 1]! << 8)) >> bit) & 0xffff;
}

/** A dialogue SetFlag action: plain pointers set bits, complex pointers rewrite a byte. */
export function applySetFlag(s: WorldState, a: DialogAction): WorldState {
  const [ptr, maskData, zero, value] = a.words;
  if (ptr === GAME_STATE_CHAPTER_TRANSITION) {
    scriptedState.chapterTransition = value !== 0;
    return s;
  }
  if (ptr >= COMPLEX_EVENT_THRESHOLD && ptr % 10 === 0) {
    const { byte } = eventFlagLocation(ptr);
    const bytes = s.bytes.slice();
    bytes[byte] = (((bytes[byte]! & (maskData & 0xff)) | (maskData >> 8)) ^ (zero & 0xff)) & 0xff;
    return { ...s, bytes };
  }
  let next = s;
  for (const p of [ptr, maskData, zero]) if (p !== 0) next = setFlag(next, p, value !== 0);
  return next;
}

// ---- Choice evaluation -----------------------------------------------------

export interface DialogEnv {
  /** Uniform integer in [0, n). Defaults to Math.random. */
  random?: (n: number) => number;
  /** Values for scripted state the world state does not hold (context, money, shop...). Default 0. */
  gameState?: (id: number) => number;
  /** Party inventory and spell checks. Default false. */
  haveItem?: (item: number) => boolean;
  /** The party holds note `n` (haveNote choices). Default false. */
  haveNote?: (note: number) => boolean;
  /** The player just cast spell `n` (castSpell choices). Default false. */
  castSpell?: (spell: number) => boolean;
  /** Value of scripted scenario state `id` (customState choices). Default 0. */
  customState?: (id: number) => number;
  /** Best active character's value of a skill (index into SKILL_NAMES), for LoadSkillValue. */
  skillValue?: (skill: number) => { value: number; character: number } | undefined;
  /** Party and context for `@N` text variables, read when a dialogue starts. Without it text is shown as written. */
  textContext?: () => TextVariableContext;
  /** Play a PlaySound action as its snippet comes up, before its text shows. Without it sounds wait in `pendingActions`. */
  playSound?: (sound: number) => void;
}

const GAME_STATE_CHAPTER = 0x7537;
const GAME_STATE_NIGHT = 0x7539;
const GAME_STATE_DAY = 0x753a;
const GAME_STATE_HOUR = 0x753c;
/** Value LoadSkillValue stored last; choices on this state compare it with min/max. */
export const GAME_STATE_SKILL_CHECK = 0x753d;

/** The value a choice's `state` selects; compared against the choice's min/max. */
export function choiceValue(c: DialogChoice, s: WorldState, env: DialogEnv): number {
  const rnd = env.random ?? ((n) => Math.floor(Math.random() * n));
  switch (c.category) {
    case 'none':
      return 1;
    case 'eventFlag':
      return getFlag(s, c.state) ? 1 : 0;
    case 'gameState': {
      const hour = hourOfDay(s.ticks);
      switch (c.state) {
        case GAME_STATE_CHAPTER:
          return s.chapter;
        case GAME_STATE_NIGHT:
          return hour < 4 || hour >= 20 ? 1 : 0;
        case GAME_STATE_DAY:
          return hour >= 4 && hour < 20 ? 1 : 0;
        case GAME_STATE_HOUR:
          return hour;
        default:
          return env.gameState?.(c.state) ?? scriptedState.read(c.state) ?? 0;
      }
    }
    case 'inventory':
      return env.haveItem?.((c.state + 0x3cb0) & 0xffff) ? 1 : 0;
    case 'customState':
      return env.customState?.(c.state & ~0x9c40 & 0xffff) ?? 0;
    case 'haveNote':
      return env.haveNote?.((c.state + 0x38c8) & 0xffff) ? 1 : 0;
    case 'castSpell':
      return env.castSpell?.(c.state - 0xcb21) ? 1 : 0;
    case 'random': {
      const range = (c.state + 0x30f8) & 0xffff;
      return range === 0 ? 0 : rnd(0x1000) % range;
    }
    default:
      // conversation, query, unknown: picked by the player, not evaluated on their own
      return 0;
  }
}

export function evaluateChoice(c: DialogChoice, s: WorldState, env: DialogEnv = {}): boolean {
  if (c.category === 'none') return true;
  if (c.category === 'complexEvent') {
    const state = readBits(s, c.state);
    const xor = c.min & 0xff;
    const expected = c.min >> 8;
    const mustEqual = c.max & 0xff;
    if (eventFlagLocation(c.state).bit !== 0) return state >= xor && state <= mustEqual;
    return mustEqual ? (((state & 0xff) ^ xor) & expected) === expected : (((state & 0xff) ^ xor) & expected) !== 0;
  }
  const v = choiceValue(c, s, env);
  return v >= c.min && (c.max === 0xffff || v <= c.max);
}

// ---- Dialogue session ------------------------------------------------------

export interface DialogOption {
  /** Event pointer (conversation) or query index (Yes = 0x100...); -1 is the "Goodbye" entry. */
  value: number;
  label: string;
}

export interface DialogView {
  snippet: DialogSnippet;
  /** Text and choices to show. Empty `options` means "click to continue". */
  options: DialogOption[];
  mode: 'text' | 'query' | 'conversation';
  /** Who speaks the snippet; absent for narration. */
  speaker?: Speaker;
}

export const GOODBYE = -1;
const MAX_STEPS = 10_000;

const isQuery = (s: DialogSnippet) => (s.displayStyle3 & 0x2) !== 0;
const isConversation = (s: DialogSnippet) => s.displayStyle3 === 0x4;
const isRandom = (s: DialogSnippet) => s.displayStyle3 === 0x8;
const isDisplayable = (s: DialogSnippet) => s.text.length > 0 || isConversation(s);

interface Pending {
  target: DialogTarget;
  /** File that offset targets are relative to. */
  file: number;
}

export class DialogSession {
  world: WorldState;
  /** The query or topic picked last, like the original's "last choice". */
  lastChoice: number | undefined;
  /** Actions with effects outside the world state (items, skills, healing, sounds...), in order. */
  readonly pendingActions: DialogAction[] = [];
  /** Zone teleport index requested by the dialogue. */
  teleport: number | undefined;
  /** Skill value LoadSkillValue stored last (game state 0x753d). */
  skillCheck = 0;
  /** Non-fatal problems, such as keys that do not resolve. */
  readonly warnings: string[] = [];

  private readonly stack: Pending[] = [];
  private current: SnippetRef | undefined;
  private viewNow: DialogView | undefined;
  private endState: number | undefined;
  private finished = false;
  /** `@N` placeholder values of this dialogue; absent when the env gives no party. */
  readonly textVars: TextVariables | undefined;

  constructor(
    private readonly store: DialogStore,
    world: WorldState,
    private readonly keywords: readonly string[] = [],
    private readonly env: DialogEnv = {},
  ) {
    this.world = world;
    const ctx = env.textContext?.();
    this.textVars = ctx && new TextVariables({ random: env.random, itemValue: scriptedState.itemValue, ...ctx });
  }

  /** Characters the dialogue picked for `@N`, by variable (what "who" values of later actions address). */
  get dialogCharacters(): readonly number[] | undefined {
    return this.textVars?.characters;
  }

  get done(): boolean {
    return this.finished;
  }

  /** Value of the last SetEndOfDialogState action the dialogue ran (towns use it to pick a follow-up action). */
  get endOfDialogState(): number | undefined {
    return this.endState;
  }

  /** What to show now, or undefined once the dialogue has ended. */
  get view(): DialogView | undefined {
    return this.viewNow;
  }

  /** Begin at a dialogue key. */
  start(key: number): void {
    this.stack.push({ target: { kind: 'key', key }, file: 0 });
    this.run();
  }

  /** The player dismissed a snippet that has no choices to pick. */
  advance(): void {
    if (this.finished || !this.viewNow || this.viewNow.options.length > 0) return;
    this.run();
  }

  /** The player picked an option of the current snippet (`GOODBYE` for the exit entry). */
  choose(value: number): void {
    const snip = this.current?.snippet;
    if (this.finished || !this.viewNow || !snip) return;
    this.lastChoice = value;
    const hit = snip.choices.find(
      (c) => (c.category === 'conversation' || c.category === 'query') && c.state === value,
    );
    if (hit) {
      if (hit.category === 'conversation')
        this.world = setFlag(this.world, CONVERSATION_CHOICE_MARKED + hit.state, true);
      this.stack.push({ target: hit.target, file: this.current!.file });
    } else if (snip.choices.length > 1) {
      this.stack.pop(); // leave the question loop
    }
    this.current = undefined;
    this.run();
  }

  private label(value: number): string {
    const text = this.keywords[value] ?? QUERY_LABELS.get(value) ?? `#${value.toString(16)}`;
    return this.textVars ? this.textVars.substitute(text) : text;
  }

  /** The snippet with its `@N` placeholders replaced. */
  private shown(snippet: DialogSnippet): DialogSnippet {
    return this.textVars ? { ...snippet, text: this.textVars.substitute(snippet.text) } : snippet;
  }

  private conversationAvailable(ptr: number): boolean {
    return getFlag(this.world, ptr) && !getFlag(this.world, CONVERSATION_OPTION_INHIBITED + ptr);
  }

  private nextTarget(): Pending | undefined {
    const cur = this.current;
    if (cur) {
      const { snippet } = cur;
      if (isRandom(snippet) && snippet.choices.length > 0) {
        const rnd = this.env.random ?? ((n: number) => Math.floor(Math.random() * n));
        return { target: snippet.choices[rnd(snippet.choices.length)]!.target, file: cur.file };
      }
      for (const c of snippet.choices)
        if (evaluateChoice(c, this.world, this.choiceEnv)) return { target: c.target, file: cur.file };
    }
    return this.stack.pop();
  }

  /** The env choices are tested against: the caller's, plus the skill check this dialogue loaded. */
  private get choiceEnv(): DialogEnv {
    return {
      ...this.env,
      gameState: (id) => (id === GAME_STATE_SKILL_CHECK ? this.skillCheck : (this.env.gameState?.(id) ?? 0)),
    };
  }

  private runActions(ref: SnippetRef): void {
    for (const a of ref.snippet.actions) {
      switch (a.type) {
        case ActionType.SetFlag:
          this.world = applySetFlag(this.world, a);
          break;
        case ActionType.PushNextDialog:
          this.stack.push({ target: a.fields.target as DialogTarget, file: ref.file });
          break;
        case ActionType.Teleport:
          this.teleport = a.words[0];
          break;
        case ActionType.SetEndOfDialogState:
          this.endState = (a.words[0] << 16) >> 16;
          break;
        case ActionType.SetTextVariable:
          this.textVars?.set(a.words[0]!, a.words[1]!);
          break;
        case ActionType.PlaySound:
          if (this.env.playSound) this.env.playSound(a.words[0]!);
          else this.pendingActions.push(a);
          break;
        case ActionType.LoadSkillValue: {
          const r = this.env.skillValue?.(a.words[1]!);
          if (!r) {
            this.pendingActions.push(a);
            break;
          }
          this.skillCheck = r.value;
          this.textVars?.setSkillChecked(r.character);
          break;
        }
        case ActionType.FreeMemory:
        case ActionType.SetPopupDimensions:
        case 0xff:
          break;
        default:
          this.pendingActions.push(a);
      }
    }
    if (this.endState === -1) this.stack.length = 0;
  }

  private run(): void {
    this.viewNow = undefined;
    for (let steps = 0; steps < MAX_STEPS; steps++) {
      const next = this.nextTarget();
      const target = next?.target;
      if (!next || !target || target.kind === 'none' || (target.kind === 'key' && target.key === 0)) {
        this.finished = true;
        return;
      }
      const ref = this.store.resolve(target, next.file);
      if (!ref) {
        this.warnings.push(`dialogue target not found: ${JSON.stringify(target)}`);
        this.finished = true;
        return;
      }
      this.current = ref;
      this.runActions(ref);
      if (isDisplayable(ref.snippet)) {
        this.viewNow = this.buildView(ref.snippet);
        return;
      }
    }
    this.warnings.push('dialogue did not terminate');
    this.finished = true;
  }

  private buildView(snippet: DialogSnippet): DialogView {
    const view = this.buildViewBase(snippet);
    const ctx = this.textVars?.speakerContext(this.keywords);
    const speaker = resolveSpeaker(snippet.actor, ctx ?? { keywords: this.keywords });
    return speaker ? { ...view, speaker } : view;
  }

  private buildViewBase(snippet: DialogSnippet): DialogView {
    if (isConversation(snippet)) {
      const options: DialogOption[] = [];
      for (const c of snippet.choices) {
        if (c.category === 'conversation' && this.conversationAvailable(c.state)) {
          options.push({ value: c.state, label: this.label(c.state) });
        }
      }
      options.push({ value: GOODBYE, label: 'Goodbye' });
      return { snippet: this.shown(snippet), options, mode: 'conversation' };
    }
    if (isQuery(snippet)) {
      const options = snippet.choices
        .filter((c) => c.category === 'query')
        .map((c) => ({ value: c.state, label: this.label(c.state) }));
      if (options.length > 0) return { snippet: this.shown(snippet), options, mode: 'query' };
    }
    return { snippet: this.shown(snippet), options: [], mode: 'text' };
  }
}

// ---- Driving a session through a UI ----------------------------------------

/** What the HUD must offer: show a view and report the pick (or that it was dismissed or cancelled). */
export type ShowDialog = (
  view: DialogView,
  done: (result: { kind: 'choose'; index: number } | { kind: 'finish' } | { kind: 'cancel' }) => void,
) => void;

/** Show each snippet in turn until the session ends; `onEnd` gets `cancelled` when the UI aborted it. */
export function runDialogSession(session: DialogSession, show: ShowDialog, onEnd: (cancelled: boolean) => void): void {
  const step = () => {
    const view = session.view;
    if (!view) return onEnd(false);
    show(view, (r) => {
      if (r.kind === 'cancel') return onEnd(true);
      if (r.kind === 'choose') {
        const option = view.options[r.index];
        if (option) session.choose(option.value);
        else return onEnd(true);
      } else {
        session.advance();
      }
      step();
    });
  };
  step();
}

// ---- Encounter runner ------------------------------------------------------

export type EncounterEvent =
  | {
      type: 'dialog';
      encounter: PlacedEncounter;
      session: DialogSession;
      /** Block encounters also stop the party: the caller should undo the last step. */
      blocks: boolean;
      /** Zone encounter with a dialogue: the party leaves once it ends (unless declined). */
      transition?: ZoneTransition;
      /** Town encounter: its entry dialogue asks whether to go in; "Yes" enters the scene. */
      town?: TownEntry;
    }
  /** A town or background encounter with no entry dialogue: the party enters the scene at once. */
  | { type: 'town'; encounter: PlacedEncounter; town: TownEntry }
  /** A zone encounter without a dialogue: the party leaves at once. */
  | { type: 'zone'; encounter: PlacedEncounter; transition: ZoneTransition }
  | { type: 'other'; encounter: PlacedEncounter };

/** Actors 1-6 are the party; anything above is a named NPC. */
const NPC_ACTOR_MIN = 6;

/** A dialogue encounter that has an NPC to stand at it. */
export interface NpcEncounter {
  encounter: PlacedEncounter;
  actor: number;
  name: string;
}

export interface EncounterRunnerOptions {
  map: EncounterMap;
  world: WorldState;
  zone: number;
  /** Index of a tile in the zone's tile list (ZxxREF.DAT order); it addresses the per-encounter flags. */
  tileIndex: (tileX: number, tileY: number) => number;
  store: DialogStore;
  /** DEF_DIAL.DAT keys by table index. */
  defDial: readonly number[];
  /** DEF_BLOC.DAT keys by table index. */
  defBloc?: readonly number[];
  /** DEF_ZONE.DAT transitions by table index. */
  defZone?: readonly ZoneTransition[];
  /** DEF_TOWN.DAT and DEF_BKGR.DAT entries by table index. */
  defTown?: readonly TownEntry[];
  defBackground?: readonly TownEntry[];
  keywords?: readonly string[];
  env?: DialogEnv;
}

/**
 * Decides which encounters fire as the party moves. An encounter fires when the party steps into
 * its rectangle (not every frame), if its flags allow it. Dialog and block encounters start a
 * `DialogSession`; the caller shows it with `runDialogSession` and then calls `finish`.
 */
export class EncounterRunner {
  world: WorldState;
  private inside = new Set<PlacedEncounter>();
  private recent = new Set<string>();
  private lastTile = -1;

  constructor(private readonly o: EncounterRunnerOptions) {
    this.world = o.world;
  }

  private isUsed(e: PlacedEncounter): boolean {
    const tile = this.o.tileIndex(e.tileX, e.tileY);
    if (getFlag(this.world, uniqueEncounterFlag(this.o.zone, tile, e.record.index))) return true;
    return this.recent.has(`${tile}:${e.record.index}`);
  }

  private markPostEncounter(e: PlacedEncounter, honourRepeatable: boolean): void {
    const r = e.record;
    if (r.completionState !== 0) this.world = setFlag(this.world, r.completionState, true);
    const tile = this.o.tileIndex(e.tileX, e.tileY);
    if (honourRepeatable && r.repeatable !== 0) return;
    if (r.chapterFlag !== 0) this.world = setFlag(this.world, uniqueEncounterFlag(this.o.zone, tile, r.index), true);
    if (honourRepeatable) this.recent.add(`${tile}:${r.index}`);
  }

  /**
   * Dialogue encounters whose first speaker is an NPC (actor number above the six party members): the
   * people who should be standing there. Worked out once by playing each dialogue on a scratch session
   * (no sounds), so it does not change the world. Chapter filtering is the map's.
   */
  npcEncounters(): NpcEncounter[] {
    if (!this.npcs) {
      this.npcs = [];
      for (const encounter of this.o.map.all()) {
        if (encounter.record.typeId !== EncounterType.Dialog) continue;
        const key = this.o.defDial[encounter.record.tableIndex];
        const speaker = key === undefined ? undefined : this.firstNpcSpeaker(key);
        if (speaker) this.npcs.push({ encounter, actor: speaker.actor, name: speaker.name });
      }
    }
    return this.npcs;
  }

  private npcs: NpcEncounter[] | undefined;

  private firstNpcSpeaker(key: number): Speaker | undefined {
    const env = { ...this.o.env, playSound: () => {} };
    const session = new DialogSession(this.o.store, this.world, this.o.keywords ?? [], env);
    session.start(key);
    // Skip narration and the odd party line; stop at the first choice, which only the player can make.
    for (let i = 0; i < 12 && session.view; i++) {
      const speaker = session.view.speaker;
      if (speaker && speaker.actor > NPC_ACTOR_MIN) return speaker;
      if (session.view.options.length > 0) return undefined;
      session.advance();
    }
    return undefined;
  }

  /** Can this encounter still fire in the party's current world (flags allow it, not yet done this chapter)? */
  isPending(e: PlacedEncounter): boolean {
    const used = (x: PlacedEncounter) =>
      getFlag(this.world, uniqueEncounterFlag(this.o.zone, this.o.tileIndex(x.tileX, x.tileY), x.record.index));
    return isEncounterActive(e, this.world, used);
  }

  /** Check the party position; returns encounters that start now, in file order. */
  update(x: number, y: number): EncounterEvent[] {
    const here = new Set(this.o.map.at(x, y));
    const tileKey = Math.floor(y / 64000) * 1024 + Math.floor(x / 64000);
    if (tileKey !== this.lastTile) {
      this.lastTile = tileKey;
      this.recent.clear();
    }
    const events: EncounterEvent[] = [];
    for (const e of here) {
      if (this.inside.has(e)) continue;
      if (!isEncounterActive(e, this.world, this.isUsed.bind(this))) continue;
      const ev = this.fire(e);
      if (ev) events.push(ev);
    }
    this.inside = here;
    return events;
  }

  private fire(e: PlacedEncounter): EncounterEvent | undefined {
    const rec: EncounterRecord = e.record;
    if (rec.typeId === EncounterType.Zone) return this.fireZone(e);
    if (rec.typeId === EncounterType.Town || rec.typeId === EncounterType.Background) return this.fireTown(e);
    const isBlock = rec.typeId === EncounterType.Block;
    if (rec.typeId !== EncounterType.Dialog && !isBlock) return { type: 'other', encounter: e };
    const key = (isBlock ? this.o.defBloc : this.o.defDial)?.[rec.tableIndex];
    if (key === undefined) return { type: 'other', encounter: e };
    // As in the original, the encounter counts as done as soon as its dialogue starts.
    this.markPostEncounter(e, !isBlock);
    const session = new DialogSession(this.o.store, this.world, this.o.keywords ?? [], this.o.env ?? {});
    session.start(key);
    return { type: 'dialog', encounter: e, session, blocks: isBlock };
  }

  private fireTown(e: PlacedEncounter): EncounterEvent {
    const table = e.record.typeId === EncounterType.Town ? this.o.defTown : this.o.defBackground;
    const town = table?.[e.record.tableIndex];
    if (!town) return { type: 'other', encounter: e };
    this.markPostEncounter(e, true);
    if (town.entryDialog === 0) return { type: 'town', encounter: e, town };
    const session = this.startDialog(town.entryDialog);
    return { type: 'dialog', encounter: e, session, blocks: false, town };
  }

  /** A dialogue session at `key`, run against the runner's current world. */
  startDialog(key: number): DialogSession {
    const session = new DialogSession(this.o.store, this.world, this.o.keywords ?? [], this.o.env ?? {});
    session.start(key);
    return session;
  }

  private fireZone(e: PlacedEncounter): EncounterEvent {
    const transition = this.o.defZone?.[e.record.tableIndex];
    if (!transition) return { type: 'other', encounter: e };
    this.markPostEncounter(e, false);
    const key = transition.dialog;
    if (key === 0) return { type: 'zone', encounter: e, transition };
    const session = new DialogSession(this.o.store, this.world, this.o.keywords ?? [], this.o.env ?? {});
    session.start(key);
    return { type: 'dialog', encounter: e, session, blocks: false, transition };
  }

  /** An encounter that runs outside the runner (a won combat) is done: set its completion flag and mark it seen. */
  complete(e: PlacedEncounter): void {
    this.markPostEncounter(e, true);
  }

  /** The party was placed here (arrival after a transition): do not fire the encounters it stands in. */
  enterAt(x: number, y: number): void {
    this.inside = new Set(this.o.map.at(x, y));
    this.lastTile = Math.floor(y / 64000) * 1024 + Math.floor(x / 64000);
    this.recent.clear();
  }

  /** Take over the world state a finished dialogue left behind (flags it set, topics marked). */
  finish(session: DialogSession): void {
    this.world = session.world;
  }

  /** Apply other changes made to the world while no dialogue is running (time, chapter...). */
  setWorld(world: WorldState): void {
    this.world = world;
  }
}
