import type { ItemIconSet } from '../data/itemIcons';
import type { Font } from '../formats/fnt';
import type { Character } from '../formats/gam';
import type { ItemDef } from '../formats/objinfo';
import type { SlotInfo } from '../game/saveGame';
import type { ZoneMap } from '../formats/zoneMap';
import type { MapLayout, PartyPose } from './mapScreen';

/** Id of a registered HUD screen, or 'none' when only the party bar and compass show. */
export type HudScreen = string;

/** What the save/load screen (F6) needs from the game: slot listing and the two actions. */
export interface SaveHandler {
  list(): Promise<SlotInfo[]>;
  /** Resolves to a short message for the status line. */
  save(slot: string): Promise<string>;
  load(slot: string): Promise<string>;
}

/** What the inventory screen asks of the game when the player acts on an item. Returns a status line. */
export interface ItemHandler {
  act(action: 'use' | 'equip' | 'give' | 'repair', character: number, slot: number, target?: number): string;
}

export type HudEvent = { type: 'key'; key: string } | { type: 'click' | 'hover' | 'rightClick'; x: number; y: number };

/** What a screen can see of the HUD it lives in. */
export interface HudHost {
  readonly width: number;
  readonly height: number;
  readonly font: Font;
  readonly items: ItemDef[];
  readonly icons: ItemIconSet | undefined;
  /** Portrait (ACTnnn image 0) of a dialogue actor, when the game has one. */
  speakerPortrait?(actor: number): (CanvasImageSource & { width: number; height: number }) | undefined;
  /** The active party, rebuilt whenever `setParty` is called. */
  readonly party: Character[];
  readonly pose: PartyPose;
  readonly map: { layout: MapLayout; zone: number } | undefined;
  readonly saveHandler: SaveHandler | undefined;
  /** Set by the game to let the inventory use, equip, repair and hand over items. */
  readonly itemHandler: ItemHandler | undefined;
  /** Close the open screen (back to the base screen, if any). */
  close(): void;
  /** The picture changed: redraw on the next frame. */
  invalidate(): void;
  /** Leave a finished modal screen without touching anything else. */
  end(id: string): void;
}

/** One HUD screen. State lives in the instance; the registry builds one per HUD. */
export interface HudScreenHandler {
  /** Key code that toggles the screen (e.g. 'KeyI'). */
  hotkey?: string;
  /** The hotkey also works while the base screen (town) is up. */
  hotkeyInBase?: boolean;
  /** Takes over input: hotkeys are ignored while it is the open screen (dialogue). */
  modal?: boolean;
  /** Stays drawn underneath other screens and is where closing returns to (the town scene). */
  base?: boolean;
  /** Receives right clicks; they are dropped otherwise. */
  rightClick?: boolean;
  /** Async work before opening (e.g. listing save slots). Runs before `open`. */
  prepare?(arg?: unknown): Promise<void>;
  /** Refuse to open (return false); called after any open modal screen was cancelled. */
  open(arg?: unknown): boolean | void;
  event(ev: HudEvent): void;
  draw(ctx: CanvasRenderingContext2D): void;
  /** Escape pressed while open; omit to close the screen. */
  escape?(): void;
  /** The screen is being closed by `HudScreens.close`: drop state. */
  close?(): void;
}

export type HudScreenFactory = (host: HudHost) => HudScreenHandler;

const factories = new Map<string, HudScreenFactory>();

/** Register a screen for every HUD created afterwards (call at module load, one import in main.ts). */
export function registerHudScreen(id: string, factory: HudScreenFactory): void {
  if (id === 'none') throw new Error("'none' is reserved");
  factories.set(id, factory);
}

export function registeredHudScreens(): ReadonlyMap<string, HudScreenFactory> {
  return factories;
}

export type { ZoneMap };
