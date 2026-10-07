import type { ItemIconSet } from '../data/itemIcons';
import type { Font } from '../formats/fnt';
import type { GamSave } from '../formats/gam';
import type { ItemDef } from '../formats/objinfo';
import type { ZoneMap } from '../formats/zoneMap';
import { partyCharacters } from './characterSheet';
import { HUD_HEIGHT, HUD_WIDTH, type DialogResult } from './dialogBox';
import {
  buildPartyBar,
  drawPartyBar,
  layoutPartyBar,
  type PartyBarLayout,
  type PartyBarMember,
  type PortraitSet,
} from './partyBar';
import { drawCompass, layoutCompass, layoutMap, type CompassLayout, type MapLayout, type PartyPose } from './mapScreen';
import './builtinScreens'; // registers the built-in screens
import type { DialogScreen, TownScreen, TownView } from './builtinScreens';
import {
  registeredHudScreens,
  registerHudScreen,
  type HudEvent,
  type HudHost,
  type HudScreen,
  type HudScreenFactory,
  type HudScreenHandler,
  type SaveHandler,
  type ItemHandler,
} from './hudRegistry';

export { registerHudScreen, type HudHost, type HudScreen, type HudScreenHandler, type SaveHandler, type ItemHandler };
export type { TownView };

export interface HudData {
  font: Font;
  save: GamSave;
  items: ItemDef[];
  /** Inventory item images; placeholders are drawn when absent. */
  icons?: ItemIconSet;
  /** HEADS.BMX portraits by character index; the party bar draws plain slots without them. */
  portraits?: PortraitSet;
}

type DialogSnippet = Parameters<DialogScreen['show']>[0];

/**
 * Screen manager for the 2560x1440 HUD overlay. Screens are registered in `hudRegistry` (see
 * `builtinScreens` for inventory I, character sheet C, save/load F6, map Tab, town and dialogue);
 * Escape closes whatever is open. No DOM access, so it is testable; `mountHud` adds the canvas and events.
 */
export class HudScreens implements HudHost {
  screen: HudScreen = 'none';
  party: ReturnType<typeof partyCharacters>;
  /** Set by the game to enable the F6 save/load screen. */
  saveHandler: SaveHandler | undefined;
  /** Set by the game to enable using and equipping items in the inventory. */
  itemHandler: ItemHandler | undefined;
  map: { layout: MapLayout; zone: number } | undefined;
  pose: PartyPose = { x: 0, y: 0, heading: 0 };
  private readonly compass: CompassLayout;
  private readonly handlers = new Map<string, HudScreenHandler>();
  /** The screen that stays underneath others and that closing returns to (the town scene). */
  private base: string | undefined;
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
    this.partyBar = {
      members,
      layout: layoutPartyBar(data.font, members.length, { canvasWidth: width, canvasHeight: height }),
    };
    for (const [id, factory] of registeredHudScreens()) this.register(id, factory);
  }

  get font(): Font {
    return this.data.font;
  }
  get items(): ItemDef[] {
    return this.data.items;
  }
  get icons(): ItemIconSet | undefined {
    return this.data.icons;
  }

  /** Add a screen to this HUD only (the module-level `registerHudScreen` covers every HUD). */
  register(id: string, factory: HudScreenFactory): void {
    this.handlers.set(id, factory(this));
  }

  /** A registered screen's handler, for feature code that feeds it data. */
  screenHandler<T extends HudScreenHandler = HudScreenHandler>(id: string): T {
    const h = this.handlers.get(id);
    if (!h) throw new Error(`No HUD screen '${id}'`);
    return h as T;
  }

  /** The party changed (items, health, who is active): redraw the bar and rebuild screens on next open. */
  setParty(party: Pick<GamSave, 'characters' | 'activeCharacters'>): void {
    this.party = partyCharacters(party);
    const members = buildPartyBar(party);
    const layout =
      members.length === this.partyBar.members.length
        ? this.partyBar.layout
        : layoutPartyBar(this.data.font, members.length, { canvasWidth: this.width, canvasHeight: this.height });
    this.partyBar = { members, layout };
    this.dirty = true;
  }

  /** The party moved or turned: redraws the compass (and the map arrow) when the heading or map position changed. */
  setPose(pose: PartyPose): void {
    const old = this.pose;
    this.pose = pose;
    if (
      Math.floor(pose.heading) !== Math.floor(old.heading) ||
      (this.screen === 'map' && (pose.x !== old.x || pose.y !== old.y))
    )
      this.dirty = true;
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

  invalidate(): void {
    this.dirty = true;
  }

  /** A modal screen finished: fall back to the base screen. */
  end(id: string): void {
    if (this.screen === id) this.screen = this.base ?? 'none';
    this.dirty = true;
  }

  private get current(): HudScreenHandler | undefined {
    return this.handlers.get(this.screen);
  }

  /** Cancel an open modal screen (dialogue), delivering its cancel result. */
  private closeModal(): void {
    const cur = this.current;
    if (cur?.modal) cur.close?.();
  }

  /** Open a registered screen. Modal screens that were open are cancelled first. */
  open(id: string, arg?: unknown): void {
    const h = this.handlers.get(id);
    if (!h) throw new Error(`No HUD screen '${id}'`);
    this.closeModal();
    if (h.open(arg) === false) return;
    this.screen = id;
    this.dirty = true;
  }

  /** Open the save/load screen on the given tab, listing slots first. */
  async openSaves(mode: 'save' | 'load' = 'save'): Promise<void> {
    const h = this.screenHandler('saves');
    if (!this.saveHandler || this.current?.modal) return;
    await h.prepare?.();
    this.open('saves', { mode });
  }

  close(): void {
    this.current?.close?.();
    this.screen = this.base ?? 'none';
    this.dirty = true;
  }

  /** Show a town scene; dialogues play on top of it and it stays until `hideTown`. */
  showTown(view: TownView): void {
    this.closeModal();
    this.screenHandler<TownScreen>('town').show(view);
    this.base = 'town';
    this.screen = 'town';
    this.dirty = true;
  }

  hideTown(): void {
    this.closeModal();
    this.screenHandler<TownScreen>('town').hide();
    this.base = undefined;
    this.screen = 'none';
    this.dirty = true;
  }

  /** Show a dialogue box; `done` gets the choice or finish result and the HUD closes. */
  showDialog(snippet: DialogSnippet, choiceLabels: string[], done: (r: DialogResult) => void): void {
    this.closeModal();
    this.screenHandler<DialogScreen>('dialog').show(snippet, choiceLabels, done);
    this.screen = 'dialog';
    this.dirty = true;
  }

  /** Returns true when the key was consumed (the caller should preventDefault). */
  keyDown(code: string, key: string): boolean {
    if (!this.current?.modal) {
      for (const [id, h] of this.handlers) {
        if (h.hotkey !== code || (this.base && !h.hotkeyInBase)) continue;
        if (this.screen === id) this.close();
        else if (id === 'saves') void this.openSaves();
        else this.open(id);
        return true;
      }
    }
    if (this.screen === 'none') return false;
    const cur = this.current;
    if (code === 'Escape') {
      if (cur?.escape) cur.escape();
      else this.close();
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

  rightClick(x: number, y: number): void {
    this.event({ type: 'rightClick', x, y });
  }

  private event(ev: HudEvent): void {
    this.dirty = true;
    const cur = this.current;
    if (!cur || (ev.type === 'rightClick' && !cur.rightClick)) return;
    cur.event(ev);
  }

  /** Clear the canvas and draw the open screen (nothing when closed). */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.width, this.height);
    this.dirty = false;
    if (this.base) this.handlers.get(this.base)?.draw(ctx);
    if (this.screen === 'none') {
      drawPartyBar(ctx, this.data.font, this.partyBar.layout, this.partyBar.members, this.data.portraits);
      drawCompass(ctx, this.data.font, this.compass, this.pose.heading);
    } else if (this.screen !== this.base) {
      this.current?.draw(ctx);
    }
  }
}

/** Create the overlay canvas inside `parent`, letterboxed to 16:9, and hook up keyboard and mouse. */
export function mountHud(parent: HTMLElement, data: HudData): HudScreens {
  const screens = new HudScreens(data);
  const canvas = document.createElement('canvas');
  canvas.width = screens.width;
  canvas.height = screens.height;
  canvas.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);aspect-ratio:16/9;width:min(100vw,177.78vh);pointer-events:none;image-rendering:pixelated';
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
  window.addEventListener(
    'mousedown',
    (e) => screens.blocking && (e.button === 2 ? screens.rightClick(...toCanvas(e)) : screens.click(...toCanvas(e))),
  );
  window.addEventListener('contextmenu', (e) => screens.blocking && e.preventDefault());

  const render = () => {
    canvas.style.pointerEvents = screens.blocking ? 'auto' : 'none';
    // A captured mouse (fly camera) would leave screens unclickable: release it while one is open.
    if (screens.blocking && document.pointerLockElement) document.exitPointerLock();
    if (screens.dirty) screens.draw(ctx);
    requestAnimationFrame(render);
  };
  render();
  return screens;
}
