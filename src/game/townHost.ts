import { HotspotAction, type GdsRef, type TownEntry } from '../formats/gds';
import { sceneCanvas } from '../ui/townScreen';
import type { TownView } from '../ui/hud';
import { destinationAt, type Destination } from './transitions';
import { TownController, type DialogEnd } from './townController';
import { activeHotspots, loadTownScene, type FetchResources, type TownScene } from './townScene';
import { loadSceneHd } from './sceneHd';
import type { WorldState } from './state';

export interface TownHostOptions {
  fetch: FetchResources;
  hud: { showTown(view: TownView): void; hideTown(): void };
  chapter: number;
  world(): WorldState;
  /** Play the dialogue at `key` (applying its effects) and call `done` when it ends. */
  playDialog(key: number, done: (end: DialogEnd) => void): void;
  /** The party clicked an inn hotspot in this scene. */
  inn?(ref: GdsRef): void;
  /** Open the shop of a scene (false when it has none). */
  shop?(ref: GdsRef): boolean;
}

/** Where the party stands outside a town encounter's door: the entry's exit cell in the encounter's tile. */
export function townExit(entry: TownEntry, tileX: number, tileY: number): Destination {
  return destinationAt(undefined, tileX, tileY, entry.exitCellX, entry.exitCellY, entry.exitHeading);
}

/** Connects the town scene controller to the HUD and the dialogue player. */
export function createTownHost(o: TownHostOptions) {
  let exitDialog = 0;
  // Upscaled pictures (see sceneHd.ts) by loaded scene; scenes without one keep the original 320x200 picture.
  const hdPictures = new WeakMap<TownScene, HTMLImageElement>();
  const controller: TownController = new TownController({
    load: async (ref) => {
      const scene = await loadTownScene(o.fetch, ref, o.chapter);
      const hd = await loadSceneHd(scene.image.rgba);
      if (hd) hdPictures.set(scene, hd);
      return scene;
    },
    show: (scene) => {
      const hotspots = activeHotspots(scene.gds, o.world(), o.chapter);
      o.hud.showTown({
        picture: hdPictures.get(scene) ?? sceneCanvas(scene.image),
        hotspots,
        onClick: (h) => controller.click(h),
        onDescribe: (h) => controller.describe(h),
        onLeave: () => controller.leave(),
      });
    },
    hide: () => o.hud.hideTown(),
    playDialog: (key, done) => o.playDialog(key, done),
    inn: o.inn,
    activeHotspots: (scene) => activeHotspots(scene.gds, o.world(), o.chapter),
    left: () => {
      const key = exitDialog;
      exitDialog = 0;
      if (key !== 0) o.playDialog(key, () => {});
    },
    shop: o.shop && ((ref) => o.shop!(ref)),
    unsupported: (action, h) => {
      const name = Object.entries(HotspotAction).find(([, v]) => v === action)?.[0] ?? `0x${action.toString(16)}`;
      console.log(`town hotspot ${h.index}: ${name} is not implemented yet`);
    },
  });

  return {
    controller,
    get active(): boolean {
      return controller.active;
    },
    /** Play a dialogue through the host's dialogue player (shops use this for their talk). */
    playDialog: o.playDialog,
    /** Open a scene; `exit` is the dialogue key to play when the party leaves it (0 = none). */
    async enter(ref: GdsRef, exit = 0): Promise<void> {
      exitDialog = exit;
      try {
        await controller.enter(ref);
      } catch (err) {
        exitDialog = 0;
        console.warn('Town scene unavailable:', err);
      }
    },
    /** Close the scene without playing the exit dialogue (the party is being moved elsewhere). */
    dismiss(): void {
      exitDialog = 0;
      if (controller.active) controller.dismiss();
    },
  };
}
