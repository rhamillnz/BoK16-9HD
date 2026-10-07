import type { ItemIconSet } from '../data/itemIcons';
import type { Font } from '../formats/fnt';
import type { GamSave } from '../formats/gam';
import type { ItemDef } from '../formats/objinfo';
import { buildSheetModel, defaultSheetOptions, drawCharacterSheet, layoutCharacterSheet, partyCharacters, stepSheet, type SheetLayout, type SheetModel, type SheetState } from './characterSheet';
import {
  HUD_HEIGHT,
  HUD_WIDTH,
  defaultBoxOptions,
  drawDialog,
  initialState,
  layoutDialog,
  step as stepDialog,
  type DialogLayout,
  type DialogResult,
  type DialogState,
} from './dialogBox';
import { buildPartyBar, drawPartyBar, layoutPartyBar, type PartyBarLayout, type PartyBarMember, type PortraitSet } from './partyBar';
import { drawSaveScreen, initialSaveScreenState, layoutSaveScreen, stepSaveScreen, type SaveScreenLayout, type SaveScreenState } from './saveScreen';
import type { SlotInfo } from '../game/saveGame';
import type { ZoneMap } from '../formats/zoneMap';
import { drawCompass, drawMap, layoutCompass, layoutMap, type CompassLayout, type MapLayout, type PartyPose } from './mapScreen';
import { defaultLayoutOptions, drawInventory, initialInventoryState, layoutInventory, stepInventory, type InventoryLayout, type InventoryState } from './inventory';

export type HudScreen = 'none' | 'inventory' | 'sheet' | 'dialog' | 'saves' | 'map';

export interface HudData {
  font: Font;
  save: GamSave;
  items: ItemDef[];
  /** Inventory item images; placeholders are drawn when absent. */
  icons?: ItemIconSet;
  /** HEADS.BMX portraits by character index; the party bar draws plain slots without them. */
  portraits?: PortraitSet;
}

/** What the save/load screen (F6) needs from the game: slot listing and the two actions. */
export interface SaveHandler {
  list(): Promise<SlotInfo[]>;
  /** Resolves to a short message for the status line. */
  save(slot: string): Promise<string>;
  load(slot: string): Promise<string>;
}

type DialogSnippet = Parameters<typeof layoutDialog>[1];

/**
 * Screen manager for the 2560x1440 HUD overlay: I opens the inventory, C the character sheet,
 * Escape closes whatever is open, and dialogue can be shown on top. No DOM access, so it is testable;
 * `mountHud` adds the canvas and event wiring.
 */
export class HudScreens {
  screen: HudScreen = 'none';
  private party;
  private inventory: { layout: InventoryLayout; state: InventoryState } | undefined;
  private sheet: { layout: SheetLayout; models: SheetModel[]; state: SheetState } | undefined;
  private dialog: { layout: DialogLayout; state: DialogState; done: (r: DialogResult) => void } | undefined;
  /** Set by the game to enable the F6 save/load screen. */
  saveHandler: SaveHandler | undefined;
  private saves: { layout: SaveScreenLayout; state: SaveScreenState; slots: SlotInfo[] } | undefined;
  private map: { layout: MapLayout; zone: number } | undefined;
  private pose: PartyPose = { x: 0, y: 0, heading: 0 };
  private readonly compass: CompassLayout;
  /** Set whenever the picture changed since the last `draw`. */
  dirty = true;
  private partyBar: { layout: PartyBarLayout; members: PartyBarMember[] };

  constructor(
    private readonly data: HudData,
    readonly width = HUD_WIDTH,
    readonly height = HUD_HEIGHT,
  ) {
    this.compass = layoutCompass(width, height);
    this.party = partyCharacters(data.save);
    const members = buildPartyBar(data.save);
    this.partyBar = { members, layout: layoutPartyBar(data.font, members.length, { canvasWidth: width, canvasHeight: height }) };
  }

  /** The party changed (items, health, who is active): redraw the bar and rebuild screens on next open. */
  setParty(party: Pick<GamSave, 'characters' | 'activeCharacters'>): void {
    this.party = partyCharacters(party);
    const members = buildPartyBar(party);
    const layout = members.length === this.partyBar.members.length
      ? this.partyBar.layout
      : layoutPartyBar(this.data.font, members.length, { canvasWidth: this.width, canvasHeight: this.height });
    this.partyBar = { members, layout };
    this.dirty = true;
  }

  /** The party moved or turned: redraws the compass (and the map arrow) when the heading or map position changed. */
  setPose(pose: PartyPose): void {
    const old = this.pose;
    this.pose = pose;
    if (Math.floor(pose.heading) !== Math.floor(old.heading) || (this.screen === 'map' && (pose.x !== old.x || pose.y !== old.y))) this.dirty = true;
  }

  /** Set the zone's map (ZxxMAP.DAT); Tab opens it. */
  setMap(map: ZoneMap, zone: number): void {
    this.map = { layout: layoutMap(map, this.width, this.height), zone };
    this.dirty = true;
  }

  /** True while a screen is open; the party controller must ignore movement then. */
  get blocking(): boolean {
    return this.screen !== 'none';
  }

  open(screen: 'inventory' | 'sheet' | 'map'): void {
    this.closeDialog({ kind: 'cancel' });
    if (screen === 'map') {
      if (!this.map) return;
    } else if (screen === 'inventory') {
      const layout = layoutInventory(defaultLayoutOptions(this.party.length, 16, this.width, this.height));
      this.inventory = { layout, state: initialInventoryState() };
    } else {
      const models = this.party.map(buildSheetModel);
      const layout = layoutCharacterSheet(this.data.font, models[0]!, this.party.map((c) => c.name), defaultSheetOptions(this.width, this.height));
      this.sheet = { layout, models, state: { tab: 0 } };
    }
    this.screen = screen;
    this.dirty = true;
  }

  /** Open the save/load screen on the given tab, listing slots first. */
  async openSaves(mode: 'save' | 'load' = 'save'): Promise<void> {
    const handler = this.saveHandler;
    if (!handler || this.screen === 'dialog') return;
    const slots = await handler.list();
    this.closeDialog({ kind: 'cancel' });
    this.saves = { layout: layoutSaveScreen(slots.length, this.width, this.height), state: initialSaveScreenState(mode), slots };
    this.screen = 'saves';
    this.dirty = true;
  }

  private async useSlot(kind: 'save' | 'load', slot: string): Promise<void> {
    const handler = this.saveHandler;
    const s = this.saves;
    if (!handler || !s) return;
    let message: string;
    try {
      message = await (kind === 'save' ? handler.save(slot) : handler.load(slot));
    } catch (err) {
      message = `Failed: ${(err as Error).message}`;
    }
    if (this.saves !== s) return;
    if (kind === 'load' && !message.startsWith('Failed')) {
      this.close();
      return;
    }
    s.slots = await handler.list();
    s.state = { ...s.state, message };
    this.dirty = true;
  }

  close(): void {
    this.saves = undefined;
    this.closeDialog({ kind: 'cancel' });
    this.screen = 'none';
    this.dirty = true;
  }

  /** Show a dialogue box; `done` gets the choice or finish result and the HUD closes. */
  showDialog(snippet: DialogSnippet, choiceLabels: string[], done: (r: DialogResult) => void): void {
    this.closeDialog({ kind: 'cancel' });
    const layout = layoutDialog(this.data.font, snippet, choiceLabels, defaultBoxOptions(this.width, this.height));
    this.dialog = { layout, state: initialState(layout), done };
    this.screen = 'dialog';
    this.dirty = true;
  }

  private closeDialog(result: DialogResult): void {
    const d = this.dialog;
    if (!d) return;
    this.dialog = undefined;
    if (this.screen === 'dialog') this.screen = 'none';
    this.dirty = true;
    d.done(result);
  }

  /** Returns true when the key was consumed (the caller should preventDefault). */
  keyDown(code: string, key: string): boolean {
    if (code === 'KeyI' && this.screen !== 'dialog') {
      if (this.screen === 'inventory') this.close();
      else this.open('inventory');
      return true;
    }
    if (code === 'KeyC' && this.screen !== 'dialog') {
      if (this.screen === 'sheet') this.close();
      else this.open('sheet');
      return true;
    }
    if (code === 'F6' && this.screen !== 'dialog') {
      if (this.screen === 'saves') this.close();
      else void this.openSaves();
      return true;
    }
    if (code === 'Tab' && this.screen !== 'dialog') {
      if (this.screen === 'map') this.close();
      else if (this.map) this.open('map');
      return true;
    }
    if (this.screen === 'none') return false;
    if (code === 'Escape') {
      this.close();
      return true;
    }
    this.event({ type: 'key', key });
    return true;
  }

  click(x: number, y: number): void {
    this.event({ type: 'click', x, y });
  }

  hover(x: number, y: number): void {
    this.event({ type: 'hover', x, y });
  }

  private event(ev: { type: 'key'; key: string } | { type: 'click' | 'hover'; x: number; y: number }): void {
    this.dirty = true;
    if (this.screen === 'inventory' && this.inventory) {
      this.inventory.state = stepInventory(this.inventory.layout, this.inventory.state, ev);
    } else if (this.screen === 'sheet' && this.sheet) {
      const r = stepSheet(this.sheet.layout, this.sheet.state, ev);
      this.sheet.state = r.state;
      if (r.result.kind === 'close') this.close();
    } else if (this.screen === 'saves' && this.saves) {
      const r = stepSaveScreen(this.saves.layout, this.saves.state, this.saves.slots, ev);
      this.saves.state = r.state;
      if (r.result.kind !== 'none') void this.useSlot(r.result.kind, r.result.slot);
    } else if (this.screen === 'dialog' && this.dialog) {
      const r = stepDialog(this.dialog.layout, this.dialog.state, ev);
      this.dialog.state = r.state;
      if (r.result.kind !== 'none') this.closeDialog(r.result);
    }
  }

  /** Clear the canvas and draw the open screen (nothing when closed). */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.width, this.height);
    this.dirty = false;
    const { font, items } = this.data;
    if (this.screen === 'inventory' && this.inventory) {
      drawInventory(ctx, font, this.inventory.layout, this.inventory.state, this.party, items, undefined, this.data.icons);
    } else if (this.screen === 'sheet' && this.sheet) {
      const { layout, models, state } = this.sheet;
      drawCharacterSheet(ctx, font, layout, models[state.tab] ?? models[0]!, state);
    } else if (this.screen === 'saves' && this.saves) {
      drawSaveScreen(ctx, font, this.saves.layout, this.saves.state, this.saves.slots);
    } else if (this.screen === 'dialog' && this.dialog) {
      drawDialog(ctx, font, this.dialog.layout, this.dialog.state);
    } else if (this.screen === 'map' && this.map) {
      drawMap(ctx, font, this.map.layout, this.pose, this.map.zone);
    } else if (this.screen === 'none') {
      drawPartyBar(ctx, font, this.partyBar.layout, this.partyBar.members, this.data.portraits);
      drawCompass(ctx, font, this.compass, this.pose.heading);
    }
  }
}

/** Create the overlay canvas inside `parent`, letterboxed to 16:9, and hook up keyboard and mouse. */
export function mountHud(parent: HTMLElement, data: HudData): HudScreens {
  const screens = new HudScreens(data);
  const canvas = document.createElement('canvas');
  canvas.width = screens.width;
  canvas.height = screens.height;
  canvas.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);aspect-ratio:16/9;width:min(100vw,177.78vh);pointer-events:none;image-rendering:pixelated';
  parent.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const toCanvas = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * screens.width, ((e.clientY - r.top) / r.height) * screens.height];
  };
  window.addEventListener('keydown', (e) => {
    if (e.repeat && !screens.blocking) return;
    if (screens.keyDown(e.code, e.key)) e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => screens.blocking && screens.hover(...toCanvas(e)));
  window.addEventListener('mousedown', (e) => screens.blocking && screens.click(...toCanvas(e)));

  const render = () => {
    canvas.style.pointerEvents = screens.blocking ? 'auto' : 'none';
    if (screens.dirty) screens.draw(ctx);
    requestAnimationFrame(render);
  };
  render();
  return screens;
}
