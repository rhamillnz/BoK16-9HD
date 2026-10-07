import { parseReq, type ReqLayout } from '../formats/req';
import { parseGdsContainers } from '../formats/gdsShops';
import type { ItemDef } from '../formats/objinfo';
import { MENU_SCREEN_ID, type MenuPanelScreen } from '../ui/menuHud';
import type { HudScreens } from '../ui/hud';
import type { PartyState } from './party';
import type { WorldState } from './state';
import { installTemples, type TempleDeps } from './templeFlow';
import type { TownController } from './townController';

/** What the temples need from the running game; the only wiring main.ts needs. */
export interface TempleHost {
  town: TownController;
  screens: HudScreens;
  items: readonly ItemDef[];
  getParty(): PartyState;
  setParty(p: PartyState): void;
  getWorld(): WorldState;
  setWorld(w: WorldState): void;
  playDialog: TempleDeps['playDialog'];
  /** Raw bytes of the save the game started from (the town containers are read from it). */
  saveBytes: Uint8Array;
  /** REQ_TELE.DAT bytes, when the install has them. */
  teleportLayout: Uint8Array | undefined;
  /** Move the party to entry `index` of TELEPORT.DAT. */
  travel(index: number): void;
}

/** Temple hotspots: talk, cure, bless; teleport between temples you have seen. */
export function installTempleControls(h: TempleHost): void {
  const panel = h.screens.screenHandler<MenuPanelScreen>(MENU_SCREEN_ID);
  let layout: ReqLayout | undefined;
  try {
    layout = h.teleportLayout && parseReq(h.teleportLayout);
  } catch (err) {
    console.warn('REQ_TELE.DAT unreadable; temple teleporting is off:', err);
  }
  const containers = parseGdsContainers(h.saveBytes);
  installTemples(h.town, {
    menu: {
      show: (model, onPick, onCancel) => {
        panel.show(model, onPick, onCancel);
        if (h.screens.screen !== MENU_SCREEN_ID) h.screens.open(MENU_SCREEN_ID);
      },
      close: () => panel.dismiss(),
    },
    playDialog: h.playDialog,
    getParty: h.getParty,
    setParty: h.setParty,
    getWorld: h.getWorld,
    setWorld: h.setWorld,
    items: h.items,
    containers: () => containers,
    teleportLayout: layout,
    travel: h.travel,
  });
}
