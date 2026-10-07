import type { ItemDef } from '../formats/objinfo';
import type { ItemHandler } from '../ui/hudRegistry';
import { giveToCharacter, repairItem, toggleEquip, useItem, type ItemUseResult } from './itemUse';
import type { PartyState } from './party';

export interface ItemControlsHost {
  items: readonly ItemDef[];
  getParty(): PartyState;
  setParty(p: PartyState): void;
  setItemHandler(h: ItemHandler): void;
}

/** Wire the inventory screen's use/equip/give/repair keys to the party state. */
export function installItemControls(host: ItemControlsHost): void {
  host.setItemHandler({
    act(action, character, slot, target) {
      const p = host.getParty();
      let r: ItemUseResult;
      switch (action) {
        case 'use': r = useItem(p, character, slot, host.items); break;
        case 'equip': r = toggleEquip(p, character, slot, host.items); break;
        case 'repair': r = repairItem(p, character, slot, host.items); break;
        case 'give': r = target === undefined ? { party: p, message: 'Nobody to give it to.', ok: false } : giveToCharacter(p, character, slot, target, host.items); break;
      }
      if (r.ok || r.party !== p) host.setParty(r.party);
      return r.message;
    },
  });
}
