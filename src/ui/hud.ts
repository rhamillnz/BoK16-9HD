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
import { defaultLayoutOptions, drawInventory, initialInventoryState, layoutInventory, stepInventory, type InventoryLayout, type InventoryState } from './inventory';

export type HudScreen = 'none' | 'inventory' | 'sheet' | 'dialog';

export interface HudData {
  font: Font;
  save: GamSave;
  items: ItemDef[];
}

type DialogSnippet = Parameters<typeof layoutDialog>[1];

/**
 * Screen manager for the 2560x1440 HUD overlay: I opens the inventory, C the character sheet,
 * Escape closes whatever is open, and dialogue can be shown on top. No DOM access, so it is testable;
 * `mountHud` adds the canvas and event wiring.
 */
export class HudScreens {
  screen: HudScreen = 'none';
  private readonly party;
  private inventory: { layout: InventoryLayout; state: InventoryState } | undefined;
  private sheet: { layout: SheetLayout; models: SheetModel[]; state: SheetState } | undefined;
  private dialog: { layout: DialogLayout; state: DialogState; done: (r: DialogResult) => void } | undefined;
  /** Set whenever the picture changed since the last `draw`. */
  dirty = true;

  constructor(
    private readonly data: HudData,
    readonly width = HUD_WIDTH,
    readonly height = HUD_HEIGHT,
  ) {
    this.party = partyCharacters(data.save);
  }

  /** True while a screen is open; the party controller must ignore movement then. */
  get blocking(): boolean {
    return this.screen !== 'none';
  }

  open(screen: 'inventory' | 'sheet'): void {
    this.closeDialog({ kind: 'cancel' });
    if (screen === 'inventory') {
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

  close(): void {
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
      drawInventory(ctx, font, this.inventory.layout, this.inventory.state, this.party, items);
    } else if (this.screen === 'sheet' && this.sheet) {
      const { layout, models, state } = this.sheet;
      drawCharacterSheet(ctx, font, layout, models[state.tab] ?? models[0]!, state);
    } else if (this.screen === 'dialog' && this.dialog) {
      drawDialog(ctx, font, this.dialog.layout, this.dialog.state);
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
