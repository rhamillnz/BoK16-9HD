import { effectiveSkill, SKILL_NAMES } from '../formats/gam';
import { ITEM_ROYALS, ITEM_SOVEREIGNS, ROYALS_PER_SOVEREIGN, activeCharacters, type PartyState } from './party';
import { GAME_STATE_ITEM_VALUE } from './dialogEffects';
import type { DialogEnv } from './encounterRunner';
import type { TextVariableContext } from './textVariables';

/**
 * Builds the `DialogEnv` the dialogue runner tests choices and fills text with, from the live
 * party. See docs/formats/dialogue.md section 8. Game-state ids follow section 3.
 */

export const GAME_STATE_MONEY = 0x7531;
export const GAME_STATE_CANT_AFFORD = 0x7533;
export const GAME_STATE_ZONE = 0x7543;

export interface DialogEnvOptions {
  getParty: () => PartyState;
  /** Zone the party is in. */
  zone: number;
  chapter: number;
  /** Extra text values and the item value of the shop or inn that is talking. */
  extras?: () => Partial<TextVariableContext>;
  haveNote?: DialogEnv['haveNote'];
  castSpell?: DialogEnv['castSpell'];
  customState?: DialogEnv['customState'];
  /** Extra game states (context, shop...) beyond the ones derived from the party. */
  gameState?: DialogEnv['gameState'];
  random?: DialogEnv['random'];
}

/** True when anyone in the party (or the key ring) carries the item; money items test the purse. */
export function partyHasItem(p: PartyState, item: number): boolean {
  if (item === ITEM_SOVEREIGNS) return p.gold >= ROYALS_PER_SOVEREIGN;
  if (item === ITEM_ROYALS) return p.gold > 0;
  if (p.partyKeys.items.some((i) => i.itemIndex === item)) return true;
  return activeCharacters(p).some((c) => c.inventory.items.some((i) => i.itemIndex === item));
}

export function makeDialogEnv(o: DialogEnvOptions): DialogEnv {
  return {
    random: o.random,
    textContext: () => ({ party: o.getParty(), chapter: o.chapter, random: o.random, ...o.extras?.() }),
    haveItem: (item) => partyHasItem(o.getParty(), item),
    haveNote: o.haveNote,
    castSpell: o.castSpell,
    customState: o.customState,
    gameState: (id) => {
      const value = o.extras?.().itemValue ?? 0;
      switch (id) {
        case GAME_STATE_MONEY: return o.getParty().gold;
        case GAME_STATE_CANT_AFFORD: return o.getParty().gold < value ? 1 : 0;
        case GAME_STATE_ITEM_VALUE: return value;
        case GAME_STATE_ZONE: return o.zone;
        default: return o.gameState?.(id) ?? 0;
      }
    },
    skillValue: (skill) => {
      const name = SKILL_NAMES[skill];
      if (!name) return undefined;
      let best: { value: number; character: number } | undefined;
      for (const c of activeCharacters(o.getParty())) {
        const value = effectiveSkill(c, name);
        if (!best || value > best.value) best = { value, character: c.index };
      }
      return best;
    },
  };
}
