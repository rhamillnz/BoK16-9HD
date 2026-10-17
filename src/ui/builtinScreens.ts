import {
  buildSheetModel,
  defaultSheetOptions,
  drawCharacterSheet,
  layoutCharacterSheet,
  stepSheet,
  type SheetLayout,
  type SheetModel,
  type SheetState,
} from './characterSheet';
import {
  defaultBoxOptions,
  drawDialog,
  initialState,
  layoutDialog,
  step as stepDialog,
  type DialogLayout,
  type DialogResult,
  type DialogState,
} from './dialogBox';
import { InventoryView } from './inventoryView';
import { MAP_COLORS } from './mapScreen';
import { drawFullMap, drawLocalMap, ZOOMS, type LocalMapView } from './localMap';
import { JumpMapScreen } from './jumpMapScreen';
import {
  drawSaveScreen,
  initialSaveScreenState,
  layoutSaveScreen,
  stepSaveScreen,
  type SaveScreenLayout,
  type SaveScreenState,
} from './saveScreen';
import {
  drawTownScreen,
  type TownFlavour,
  initialTownState,
  layoutTownScreen,
  stepTown,
  type TownLayout,
  type TownState,
} from './townScreen';
import type { SlotInfo } from '../game/saveGame';
import type { Hotspot } from '../formats/gds';
import { registerHudScreen, type HudEvent, type HudHost, type HudScreenHandler } from './hudRegistry';

type DialogSnippet = Parameters<typeof layoutDialog>[1] & {
  /** Who speaks it; the box shows the name and, when the HUD has one, the portrait. */
  speaker?: { actor: number; name: string };
};

/** A town or temple scene shown full-screen: the picture, its available hotspots and what clicks do. */
export interface TownView {
  picture: CanvasImageSource;
  hotspots: Hotspot[];
  onClick(h: Hotspot): void;
  onDescribe(h: Hotspot): void;
  onLeave(): void;
  /** The place name and description shown under the picture. */
  flavour?: TownFlavour;
}

/** Inventory (I): the list + details DOM overlay of `inventoryView.ts`; the canvas draws nothing for it. */
class InventoryScreen implements HudScreenHandler {
  hotkey = 'KeyI';
  /** Tab switches character here instead of opening the map. */
  ownsKeys = ['Tab'];
  private readonly view: InventoryView;
  constructor(host: HudHost) {
    this.view = new InventoryView(host);
  }
  open(arg?: unknown): void {
    this.view.open(typeof arg === 'number' ? arg : undefined);
  }
  close(): void {
    this.view.close();
  }
  event(ev: HudEvent): void {
    this.view.event(ev);
  }
  draw(): void {
    // The party changed (setParty marks the HUD dirty): keep the overlay in step.
    this.view.refresh();
  }
}

class SheetScreen implements HudScreenHandler {
  hotkey = 'KeyC';
  private s: { layout: SheetLayout; models: SheetModel[]; state: SheetState } | undefined;
  constructor(private readonly host: HudHost) {}
  open(): void {
    const h = this.host;
    const models = h.party.map(buildSheetModel);
    const layout = layoutCharacterSheet(
      h.font,
      models[0]!,
      h.party.map((c) => c.name),
      defaultSheetOptions(h.width, h.height),
    );
    this.s = { layout, models, state: { tab: 0 } };
  }
  event(ev: Parameters<typeof stepSheet>[2]): void {
    if (!this.s) return;
    const r = stepSheet(this.s.layout, this.s.state, ev);
    this.s.state = r.state;
    if (r.result.kind === 'close') this.host.close();
    else if (r.result.kind === 'toggle') {
      const c = this.host.party[r.state.tab];
      if (c) this.host.itemHandler?.toggleSkill?.(c.index, r.result.skill);
      // The party was rebuilt: show the new selection.
      this.s.models = this.host.party.map(buildSheetModel);
      this.host.invalidate();
    } else if (ev.type === 'key') this.host.invalidate();
  }
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.s) return;
    const { layout, models, state } = this.s;
    drawCharacterSheet(ctx, this.host.font, layout, models[state.tab] ?? models[0]!, state);
  }
}

/** Tab: the map of the party's surroundings; F switches to the full map of the kingdom (manual pp. 20, 21). */
class MapScreen implements HudScreenHandler {
  hotkey = 'Tab';
  hotkeyInBase = true;
  ownsKeys = ['KeyN', 'KeyF', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'] as const;
  /** Survives closing the map: the player's choice of north-up and zoom stays. */
  private view: LocalMapView = { northUp: false, zoom: 4, full: false };
  constructor(private readonly host: HudHost) {}
  open(): boolean {
    this.view = { ...this.view, full: false, hover: undefined };
    return this.host.map !== undefined;
  }
  event(ev: HudEvent): void {
    if (ev.type === 'key') {
      const i = ZOOMS.indexOf(this.view.zoom as (typeof ZOOMS)[number]);
      // The HUD passes the character typed (KeyboardEvent.key).
      const k = ev.key.toLowerCase();
      if (k === 'n') this.view.northUp = !this.view.northUp;
      else if (k === 'f' && this.host.map?.extras?.full) this.view.full = !this.view.full;
      else if (k === '+' || k === '=') this.view.zoom = ZOOMS[Math.max(0, i - 1)]!;
      else if (k === '-' || k === '_') this.view.zoom = ZOOMS[Math.min(ZOOMS.length - 1, i + 1)]!;
      else return;
      this.host.invalidate();
    } else if (ev.type === 'hover' && this.view.full) {
      this.view.hover = { x: ev.x, y: ev.y };
      this.host.invalidate();
    }
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const h = this.host;
    if (!h.map) return;
    const { layout, zone, extras } = h.map;
    if (this.view.full && extras?.full) {
      drawFullMap(ctx, h.font, layout.panel, layout.scale, MAP_COLORS, extras.full, this.view, performance.now());
      // Keep the party marker flashing.
      setTimeout(() => h.invalidate(), 400);
      return;
    }
    drawLocalMap(
      ctx,
      h.font,
      layout.panel,
      layout.scale,
      MAP_COLORS,
      h.pose,
      zone,
      layout.tiles,
      layout.overhead,
      extras,
      this.view,
    );
  }
}

class SavesScreen implements HudScreenHandler {
  hotkey = 'F6';
  hotkeyInBase = true;
  private s: { layout: SaveScreenLayout; state: SaveScreenState; slots: SlotInfo[] } | undefined;
  private pending: SlotInfo[] = [];
  constructor(private readonly host: HudHost) {}
  async prepare(): Promise<void> {
    this.pending = (await this.host.saveHandler?.list()) ?? [];
  }
  open(arg?: unknown): boolean {
    if (!this.host.saveHandler) return false;
    const mode = (arg as { mode?: 'save' | 'load' } | undefined)?.mode ?? 'save';
    const slots = this.pending;
    this.s = {
      layout: layoutSaveScreen(slots.length, this.host.width, this.host.height),
      // The player cannot write the autosave, so saving starts on the next slot.
      state: {
        ...initialSaveScreenState(mode),
        ...(mode === 'save' && slots[0]?.slot === 'auto' ? { selected: 1 } : {}),
      },
      slots,
    };
    return true;
  }
  close(): void {
    this.s = undefined;
  }
  event(ev: Parameters<typeof stepSaveScreen>[3]): void {
    if (!this.s) return;
    const r = stepSaveScreen(this.s.layout, this.s.state, this.s.slots, ev);
    this.s.state = r.state;
    if (r.result.kind !== 'none') void this.useSlot(r.result.kind, r.result.slot);
  }
  private async useSlot(kind: 'save' | 'load', slot: string): Promise<void> {
    const handler = this.host.saveHandler;
    const s = this.s;
    if (!handler || !s) return;
    let message: string;
    try {
      message = await (kind === 'save' ? handler.save(slot) : handler.load(slot));
    } catch (err) {
      message = `Failed: ${(err as Error).message}`;
    }
    if (this.s !== s) return;
    if (kind === 'load' && !message.startsWith('Failed')) {
      this.host.close();
      return;
    }
    s.slots = await handler.list();
    s.state = { ...s.state, message };
    this.host.invalidate();
  }
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.s) drawSaveScreen(ctx, this.host.font, this.s.layout, this.s.state, this.s.slots);
  }
}

/** The town scene: stays under other screens until hidden; dialogues play on top. */
export class TownScreen implements HudScreenHandler {
  base = true;
  rightClick = true;
  private s: { layout: TownLayout; state: TownState; view: TownView } | undefined;
  constructor(private readonly host: HudHost) {}
  show(view: TownView): void {
    this.s = { layout: layoutTownScreen(this.host.width, this.host.height), state: initialTownState(), view };
  }
  hide(): void {
    this.s = undefined;
  }
  open(): boolean {
    return this.s !== undefined;
  }
  escape(): void {
    this.s?.view.onLeave();
  }
  event(ev: Parameters<typeof stepTown>[3]): void {
    if (!this.s) return;
    const r = stepTown(this.s.layout, this.s.view.hotspots, this.s.state, ev);
    this.s.state = r.state;
    if (r.result.kind === 'click') this.s.view.onClick(r.result.hotspot);
    else if (r.result.kind === 'describe') this.s.view.onDescribe(r.result.hotspot);
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const h = this.host;
    const s = this.s;
    // The flavour text is the scene's idle text: a dialogue or a shop on top replaces it, as in the original.
    const flavour = h.screen === undefined || h.screen === 'town' ? s?.view.flavour : undefined;
    if (s) drawTownScreen(ctx, h.font, s.layout, s.view.picture, s.state, h.width, h.height, flavour);
  }
}

/** A dialogue box; `done` gets the choice or finish result and the screen ends. */
export class DialogScreen implements HudScreenHandler {
  modal = true;
  private s:
    | { layout: DialogLayout; state: DialogState; done: (r: DialogResult) => void; portrait?: CanvasImageSource }
    | undefined;
  constructor(private readonly host: HudHost) {}
  show(snippet: DialogSnippet, choiceLabels: string[], done: (r: DialogResult) => void): void {
    const h = this.host;
    const portrait = snippet.speaker ? h.speakerPortrait?.(snippet.speaker.actor) : undefined;
    const speaker = snippet.speaker && {
      name: snippet.speaker.name,
      portrait: portrait && { width: Number(portrait.width), height: Number(portrait.height) },
    };
    const layout = layoutDialog(h.font, snippet, choiceLabels, defaultBoxOptions(h.width, h.height), speaker);
    this.s = { layout, state: initialState(layout), done, portrait };
  }
  open(): boolean {
    return this.s !== undefined;
  }
  /** Finish with `result`: clear state, leave the screen, then tell the caller. */
  finish(result: DialogResult): void {
    const d = this.s;
    if (!d) return;
    this.s = undefined;
    this.host.end('dialog');
    d.done(result);
  }
  close(): void {
    this.finish({ kind: 'cancel' });
  }
  event(ev: Parameters<typeof stepDialog>[2]): void {
    if (!this.s) return;
    const r = stepDialog(this.s.layout, this.s.state, ev);
    this.s.state = r.state;
    if (r.result.kind !== 'none') this.finish(r.result);
  }
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.s) drawDialog(ctx, this.host.font, this.s.layout, this.s.state, { portrait: this.s.portrait });
  }
}

// Mouse-only screens ignore right clicks: the host drops them unless `rightClick` is set.
registerHudScreen('town', (h) => new TownScreen(h));
registerHudScreen('dialog', (h) => new DialogScreen(h));
registerHudScreen('inventory', (h) => new InventoryScreen(h));
registerHudScreen('sheet', (h) => new SheetScreen(h));
registerHudScreen('saves', (h) => new SavesScreen(h));
registerHudScreen('map', (h) => new MapScreen(h));
registerHudScreen('jumpmap', (h) => new JumpMapScreen(h));
