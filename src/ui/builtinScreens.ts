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
import {
  defaultLayoutOptions,
  drawInventory,
  initialInventoryState,
  layoutInventory,
  slotCountFor,
  stepInventory,
  type InventoryLayout,
  type InventoryState,
} from './inventory';
import { drawMap } from './mapScreen';
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
  initialTownState,
  layoutTownScreen,
  stepTown,
  type TownLayout,
  type TownState,
} from './townScreen';
import type { SlotInfo } from '../game/saveGame';
import type { Hotspot } from '../formats/gds';
import { registerHudScreen, type HudEvent, type HudHost, type HudScreenHandler } from './hudRegistry';

type DialogSnippet = Parameters<typeof layoutDialog>[1];

/** A town or temple scene shown full-screen: the picture, its available hotspots and what clicks do. */
export interface TownView {
  picture: CanvasImageSource;
  hotspots: Hotspot[];
  onClick(h: Hotspot): void;
  onDescribe(h: Hotspot): void;
  onLeave(): void;
}

class InventoryScreen implements HudScreenHandler {
  hotkey = 'KeyI';
  rightClick = true;
  private s: { layout: InventoryLayout; state: InventoryState; message: string } | undefined;
  constructor(private readonly host: HudHost) {}
  open(): void {
    const h = this.host;
    this.s = {
      layout: layoutInventory(defaultLayoutOptions(h.party.length, slotCountFor(h.party), h.width, h.height)),
      state: initialInventoryState(),
      message: '',
    };
  }
  private act(action: 'use' | 'equip' | 'give' | 'repair'): void {
    const s = this.s;
    const h = this.host;
    const c = h.party[s!.state.tab];
    if (!s || !c || !h.itemHandler) return;
    const target =
      action === 'give' && h.party.length > 1 ? h.party[(s.state.tab + 1) % h.party.length]?.index : undefined;
    s.message = h.itemHandler.act(action, c.index, s.state.selected, target);
    h.invalidate();
  }
  event(ev: HudEvent): void {
    const s = this.s;
    if (!s) return;
    if (ev.type === 'rightClick') {
      s.state = stepInventory(s.layout, s.state, { type: 'click', x: ev.x, y: ev.y });
      this.act('use');
      return;
    }
    if (ev.type === 'key') {
      const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      const action =
        key === 'Enter' || key === 'u'
          ? 'use'
          : key === 'x'
            ? 'equip'
            : key === 't'
              ? 'give'
              : key === 'r'
                ? 'repair'
                : undefined;
      if (action) {
        this.act(action);
        return;
      }
    }
    s.state = stepInventory(s.layout, s.state, ev as Parameters<typeof stepInventory>[2]);
    s.message = '';
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const h = this.host;
    if (this.s)
      drawInventory(ctx, h.font, this.s.layout, this.s.state, h.party, h.items, undefined, h.icons, this.s.message);
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
  }
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.s) return;
    const { layout, models, state } = this.s;
    drawCharacterSheet(ctx, this.host.font, layout, models[state.tab] ?? models[0]!, state);
  }
}

class MapScreen implements HudScreenHandler {
  hotkey = 'Tab';
  hotkeyInBase = true;
  constructor(private readonly host: HudHost) {}
  open(): boolean {
    return this.host.map !== undefined;
  }
  event(): void {}
  draw(ctx: CanvasRenderingContext2D): void {
    const h = this.host;
    if (h.map) drawMap(ctx, h.font, h.map.layout, h.pose, h.map.zone);
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
      state: initialSaveScreenState(mode),
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
    if (this.s) drawTownScreen(ctx, h.font, this.s.layout, this.s.view.picture, this.s.state, h.width, h.height);
  }
}

/** A dialogue box; `done` gets the choice or finish result and the screen ends. */
export class DialogScreen implements HudScreenHandler {
  modal = true;
  private s: { layout: DialogLayout; state: DialogState; done: (r: DialogResult) => void } | undefined;
  constructor(private readonly host: HudHost) {}
  show(snippet: DialogSnippet, choiceLabels: string[], done: (r: DialogResult) => void): void {
    const h = this.host;
    const layout = layoutDialog(h.font, snippet, choiceLabels, defaultBoxOptions(h.width, h.height));
    this.s = { layout, state: initialState(layout), done };
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
    if (this.s) drawDialog(ctx, this.host.font, this.s.layout, this.s.state);
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
