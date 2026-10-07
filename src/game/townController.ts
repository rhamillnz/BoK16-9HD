import { HotspotAction, gdsLetter, hotspotHasDialog, type GdsRef, type Hotspot } from '../formats/gds';
import { runsImmediately, type TownScene } from './townScene';

export interface DialogEnd {
  /** The UI aborted the dialogue. */
  cancelled: boolean;
  /** Value set by the dialogue's SetEndOfDialogState action, if it ran one. */
  endState: number | undefined;
}

export interface TownHooks {
  load(ref: GdsRef): Promise<TownScene>;
  /** Put the scene on screen (or replace the one shown). */
  show(scene: TownScene): void;
  /** Take the scene off screen. */
  hide(): void;
  /** Play the dialogue at `key`, then call `done`. */
  playDialog(key: number, done: (end: DialogEnd) => void): void;
  /** Hotspots that are available now (chapter and event flags). */
  activeHotspots(scene: TownScene): Hotspot[];
  /** The party left the scene. */
  left(): void;
  /** An action that is not implemented yet (shops, inns, temples, bards...). */
  unsupported?(action: number, hotspot: Hotspot): void;
}

/**
 * Where the dialogue's end state sends the scene next: BaKGL maps `endState + 5` to a follow-up action
 * (-1 nothing, -2 barmaid, -3 inn, -4 leave, -5 repair); any other state keeps the clicked hotspot's action.
 */
export function actionAfterDialog(endState: number | undefined, clicked: number): number {
  switch ((endState ?? 0) + 5) {
    case 4: return HotspotAction.Unknown0;
    case 3: return HotspotAction.Barmaid;
    case 2: return HotspotAction.Inn;
    case 1: return HotspotAction.Exit;
    case 0: return HotspotAction.Repair2;
    default: return clicked;
  }
}

/**
 * Runs a town or temple scene: shows the 2D screen, answers hotspot clicks by playing their dialogue and
 * then doing their action (leave, go to another scene of the town). One click is handled at a time.
 */
export class TownController {
  private scene: TownScene | undefined;
  private busy = false;

  constructor(private readonly hooks: TownHooks) {}

  get active(): boolean {
    return this.scene !== undefined;
  }

  /** The scene currently shown. */
  get current(): TownScene | undefined {
    return this.scene;
  }

  /** Open a scene; hotspots flagged to run immediately are clicked at once. */
  async enter(ref: GdsRef): Promise<void> {
    const scene = await this.hooks.load(ref);
    this.scene = scene;
    this.busy = false;
    this.hooks.show(scene);
    const auto = this.hooks.activeHotspots(scene).find(runsImmediately);
    if (auto) this.click(auto);
  }

  /** Left click on a hotspot. */
  click(h: Hotspot): void {
    const scene = this.scene;
    if (!scene || this.busy) return;
    if (hotspotHasDialog(h) && h.action !== HotspotAction.Temple) {
      this.busy = true;
      this.hooks.playDialog(h.arg3, (end) => {
        this.busy = false;
        if (end.cancelled || this.scene !== scene) return;
        this.run(scene, h, actionAfterDialog(end.endState, h.action));
      });
    } else {
      this.run(scene, h, h.action);
    }
  }

  /** Right click: the hotspot's tooltip dialogue. */
  describe(h: Hotspot): void {
    if (!this.scene || this.busy || !hotspotHasDialog({ ...h, arg3: h.tooltip })) return;
    this.busy = true;
    this.hooks.playDialog(h.tooltip, () => {
      this.busy = false;
    });
  }

  /** Leave the scene (the Exit hotspot, or Escape). */
  leave(): void {
    if (!this.scene) return;
    this.scene = undefined;
    this.hooks.hide();
    this.hooks.left();
  }

  /** Close the scene without the `left` notification. */
  dismiss(): void {
    if (!this.scene) return;
    this.scene = undefined;
    this.hooks.hide();
  }

  private run(scene: TownScene, h: Hotspot, action: number): void {
    switch (action) {
      case HotspotAction.Exit:
        this.leave();
        break;
      case HotspotAction.Goto:
        void this.enter({ number: scene.ref.number, letter: gdsLetter(h.arg1) });
        break;
      case HotspotAction.Unknown0:
      case HotspotAction.Unknown1:
      case HotspotAction.Dialog:
        break; // the dialogue was the whole action
      default:
        this.hooks.unsupported?.(action, h);
    }
  }
}
