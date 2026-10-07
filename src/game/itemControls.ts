import { playSfx } from '../audio/sfxBus';
import { Snd } from '../audio/soundIds';
import type { ItemDef } from '../formats/objinfo';
import type { ItemHandler } from '../ui/hudRegistry';
import type { SpellDef } from '../formats/spells';
import { giveToCharacter, repairItem, toggleEquip, useItem, type ItemUseResult } from './itemUse';
import type { PartyState } from './party';

export interface ItemControlsHost {
  items: readonly ItemDef[];
  /** SPELLS.DAT, so scrolls can teach spells. */
  spells?: readonly SpellDef[];
  getParty(): PartyState;
  setParty(p: PartyState): void;
  setItemHandler(h: ItemHandler): void;
}

/** Wire the inventory screen's use/equip/give/repair keys to the party state. */
export function installItemControls(host: ItemControlsHost): void {
  // Books already read, per character (not saved: a reload makes each book a first reading again).
  const read = new Set<string>();
  host.setItemHandler({
    act(action, character, slot, target) {
      const p = host.getParty();
      let r: ItemUseResult;
      switch (action) {
        case 'use':
          r = useItem(p, character, slot, host.items, {
            spells: host.spells,
            hasRead: (c, i) => read.has(`${c}:${i}`),
            markRead: (c, i) => {
              read.add(`${c}:${i}`);
            },
          });
          break;
        case 'equip':
          r = toggleEquip(p, character, slot, host.items);
          break;
        case 'repair':
          r = repairItem(p, character, slot, host.items);
          break;
        case 'give':
          r =
            target === undefined
              ? { party: p, message: 'Nobody to give it to.', ok: false }
              : giveToCharacter(p, character, slot, target, host.items);
          break;
      }
      if (r.ok || r.party !== p) host.setParty(r.party);
      if (r.ok) {
        const def = host.items[p.characters.find((c) => c.index === character)?.inventory.items[slot]?.itemIndex ?? -1];
        if (action === 'use' && def?.useSound) playSfx(def.useSound, def.soundPlayTimes + 1);
        else if (action === 'equip') playSfx(Snd.drag);
      }
      return r.message;
    },
  });
}
