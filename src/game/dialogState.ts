import { ROYALS_PER_SOVEREIGN } from './party';

/**
 * Scripted game state that dialogue choices read but the world state does not hold (see
 * docs/formats/dialogue.md section 3). Shops, inns and temples set these before playing their
 * dialogue; `choiceValue` in encounterRunner falls back to them.
 */
export const GAME_STATE_CONTEXT = 0x7530;
export const GAME_STATE_MONEY = 0x7531;
export const GAME_STATE_CAN_AFFORD = 0x7533;
export const GAME_STATE_ITEM_VALUE = 0x753e;
export const GAME_STATE_CONTEXT2 = 0x753f;
export const GAME_STATE_SHOP = 0x7542;
/** Event pointer a dialogue sets to end the chapter; it has no saved bit, so it lives here. */
export const GAME_STATE_CHAPTER_TRANSITION = 0x7541;

export class ScriptedState {
  /** 0x7530: what the scene's dialogue is about (an inn: 1 once the party has slept). */
  context = 0;
  /** 0x753e: price of whatever is being bought, in royals; also the `@` money text variable. */
  itemValue = 0;
  /** Party money in royals, for 0x7531 and 0x7533. */
  gold = 0;
  /** 0x7542: the shop's repair types. */
  shopType = 0;
  /** 0x753f. */
  context2 = 0;
  /** 0x7541: a dialogue asked for the next chapter (see chapters.ts). */
  chapterTransition = false;

  /** The value of a scripted state id, or undefined when this holder does not know it. */
  read(id: number): number | undefined {
    switch (id) {
      case GAME_STATE_CONTEXT: return this.context;
      // Original names: "Money" is whole sovereigns, "CantAfford" is true when money exceeds the price.
      case GAME_STATE_MONEY: return Math.floor(this.gold / ROYALS_PER_SOVEREIGN);
      case GAME_STATE_CAN_AFFORD: return this.gold > this.itemValue ? 1 : 0;
      case GAME_STATE_ITEM_VALUE: return this.itemValue;
      case GAME_STATE_CONTEXT2: return this.context2;
      case GAME_STATE_SHOP: return this.shopType;
      default: return undefined;
    }
  }

  reset(): void {
    this.context = 0;
    this.itemValue = 0;
    this.shopType = 0;
    this.context2 = 0;
  }
}

/** The one shared instance the dialogue runner reads. */
export const scriptedState = new ScriptedState();
