import { ActionType, type DialogAction } from '../formats/ddx';
import { CONDITION_NAMES, type ExpiringEvent } from '../formats/gam';
import type { ItemDef } from '../formats/objinfo';
import { ItemType } from '../formats/objinfo';
import {
  activeCharacters,
  addCondition,
  gainRoyals,
  giveItem,
  healCharacter,
  learnSpell,
  loseRoyals,
  removeItem,
  updateCharacter,
  type ItemRule,
  type PartyState,
} from './party';
import { advanceTime, setFlag, type WorldState } from './state';

/**
 * Applies the dialogue actions `DialogSession` could not apply itself (`pendingActions`) to the
 * world state and the party. Semantics follow the original as documented in docs/formats/dialogue.md
 * section 7.1; anything not listed there is returned in `unhandled` and left alone.
 */

/** Game-state id the original keeps the "item value" in (price of the thing being bought or sold). */
export const GAME_STATE_ITEM_VALUE = 0x753e;

/** SpecialAction types that move money by the item value. */
const SPECIAL_REDUCE_GOLD = 0;
const SPECIAL_INCREASE_GOLD = 1;

/** Expiring-event types stored in `WorldState.expiringEvents`. */
const EXPIRING_RESET_STATE = 4;
/** Flags the original stores with a reset-state timer. */
const RESET_STATE_FLAGS = 0x40;

export interface DialogEffectsContext {
  world: WorldState;
  party: PartyState;
  /** OBJINFO definitions by index; without them every item is a single non-stacking, non-key item. */
  items?: readonly ItemDef[];
  /** Uniform integer in [0, n). Defaults to Math.random. */
  random?: (n: number) => number;
  /** Scripted game state, such as the item value that SpecialAction money moves read. Default 0. */
  gameState?: (id: number) => number;
  /**
   * Characters that actions with a "who" of 2 or more address (who - 2 indexes this list), as picked
   * by the dialogue. When absent those actions apply to the whole active party.
   */
  dialogCharacters?: readonly number[];
}

export interface DialogEffectsResult {
  world: WorldState;
  party: PartyState;
  /** Game time the dialogue spent (ElapseTime); the caller should move the clock and sky. */
  ticksElapsed: number;
  /** Items dropped because nobody had room. */
  lostItems: { itemIndex: number; quantity: number }[];
  /** Actions with no effect here (sounds, skills, text variables, combat...), in order. */
  unhandled: DialogAction[];
}

function ruleFor(items: readonly ItemDef[] | undefined, index: number): ItemRule | undefined {
  const def = items?.[index];
  return def && { stackSize: def.stackSize, defaultStackSize: def.defaultStackSize, isKey: def.type === ItemType.Key };
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const u32 = (lo: number, hi: number) => ((hi << 16) | lo) >>> 0;

export function applyDialogEffects(ctx: DialogEffectsContext, actions: readonly DialogAction[]): DialogEffectsResult {
  const rnd = ctx.random ?? ((n: number) => Math.floor(Math.random() * n));
  let { world, party } = ctx;
  let ticksElapsed = 0;
  const lostItems: DialogEffectsResult['lostItems'] = [];
  const unhandled: DialogAction[] = [];

  /** Characters a "who" selects: 0 and 1 mean everyone active. */
  const targets = (who: number): number[] => {
    const all = activeCharacters(party).map((c) => c.index);
    if (who <= 1) return all;
    const picked = ctx.dialogCharacters?.[who - 2];
    return picked === undefined ? all : [picked];
  };
  const randomBetween = (min: number, max: number) => (min === max ? max : min + (rnd(0x1000) % Math.max(1, max - min)));

  for (const a of actions) {
    const f = a.fields;
    switch (a.type) {
      case ActionType.GiveItem: {
        const item = num(f.item);
        const quantity = Math.max(1, num(f.quantity));
        const who = num(f.character);
        const r = giveItem(party, item, quantity, ruleFor(ctx.items, item), who > 1 ? targets(who)[0] : undefined);
        party = r.party;
        if (r.lost) lostItems.push({ itemIndex: item, quantity });
        break;
      }
      case ActionType.LoseItem:
      case ActionType.LoseNOfItem: {
        const item = num(f.item);
        party = removeItem(party, item, Math.max(1, num(f.quantity)), ruleFor(ctx.items, item));
        break;
      }
      case ActionType.HealCharacters: {
        const amount = num(f.amount);
        for (const index of targets(num(f.who))) party = updateCharacter(party, index, (c) => healCharacter(c, amount));
        // A full heal also counts as a night's rest.
        if (amount >= 100) world = { ...world, ticksLastSlept: world.ticks };
        break;
      }
      case ActionType.GainCondition: {
        const name = CONDITION_NAMES[num(f.condition)];
        if (!name) {
          unhandled.push(a);
          break;
        }
        const amount = randomBetween(num(f.min), num(f.max));
        for (const index of targets(num(f.who))) party = updateCharacter(party, index, (c) => addCondition(c, name, amount));
        break;
      }
      case ActionType.LearnSpell: {
        // Unlike the other actions, "who" here indexes the dialogue's character list directly.
        const who = num(f.who);
        const index = ctx.dialogCharacters?.[who] ?? activeCharacters(party)[who]?.index;
        if (index === undefined) {
          unhandled.push(a);
          break;
        }
        party = updateCharacter(party, index, (c) => learnSpell(c, num(f.spell)));
        break;
      }
      case ActionType.UpdateCharacters: {
        const chars = (f.characters as number[] | undefined) ?? [];
        const known = chars.filter((i) => party.characters.some((c) => c.index === i));
        if (known.length > 0) party = { ...party, activeCharacters: known };
        break;
      }
      case ActionType.ElapseTime: {
        const ticks = num(f.time);
        // Time spent in a conversation: no rations, no sleep warnings (there is no dialog to show them in).
        world = advanceTime(world, ticks, { consumeRations: false, canShowDialog: false }).state;
        ticksElapsed += ticks;
        break;
      }
      case ActionType.SetAddResetState: {
        // Sets the flag now and queues its reset.
        const ptr = a.words[0];
        const duration = u32(a.words[2], a.words[3]);
        world = setFlag(world, ptr, true);
        world = addExpiring(world, { type: EXPIRING_RESET_STATE, flags: RESET_STATE_FLAGS, data: ptr, duration });
        break;
      }
      case ActionType.SetTimeExpiringState: {
        const duration = u32(a.words[2], a.words[3]);
        world = addExpiring(world, { type: a.raw[0]!, flags: a.raw[1]!, data: a.words[1], duration });
        break;
      }
      case ActionType.SpecialAction: {
        const value = ctx.gameState?.(GAME_STATE_ITEM_VALUE) ?? 0;
        if (num(f.special) === SPECIAL_REDUCE_GOLD) party = loseRoyals(party, value);
        else if (num(f.special) === SPECIAL_INCREASE_GOLD) party = gainRoyals(party, value);
        else unhandled.push(a);
        break;
      }
      default:
        unhandled.push(a);
    }
  }
  return { world, party, ticksElapsed, lostItems, unhandled };
}

function addExpiring(world: WorldState, e: ExpiringEvent): WorldState {
  return { ...world, expiringEvents: [...world.expiringEvents, e] };
}
