import { playSfx } from '../audio/sfxBus';
import { Snd } from '../audio/soundIds';
import type { ShopStats } from '../formats/gdsContainers';
import type { GdsRef } from '../formats/gds';
import { QUERY_NO } from './encounterRunner';
import { scriptedState } from './dialogState';
import { activeCharacters, loseRoyals, ROYALS_PER_SOVEREIGN, type ItemRule, type PartyState } from './party';
import { canHeal, rest } from './rest';
import { getFlag, type WorldState } from './state';
import type { DialogEnd } from './townController';

/** Dialogue key of the innkeeper's offer (the same for every inn). */
export const INN_DIALOG_KEY = 0x13d672;
/** Chapter 5: the Eortis inn charges 0x48 sovereigns until this event flag is set, then 0xa. */
export const FLAG_CHAPTER5_INN_CHEAP = 0xdb1c;

/** Price of a night in royals. The stats hold sovereigns. */
export function innCostRoyals(stats: Pick<ShopStats, 'innCost'>, chapter: number, world: WorldState): number {
  let sovereigns = stats.innCost;
  if (chapter === 5) sovereigns = getFlag(world, FLAG_CHAPTER5_INN_CHEAP) ? 0xa : 0x48;
  return sovereigns * ROYALS_PER_SOVEREIGN;
}

/** The party took the offer: the dialogue did not end the scene (-1) and the last answer was not No. */
export function acceptedOffer(end: DialogEnd): boolean {
  return !end.cancelled && end.endState !== -1 && end.choice !== QUERY_NO;
}

export interface NightResult {
  world: WorldState;
  party: PartyState;
  hours: number;
  /** Someone could still heal: the innkeeper offers another night. */
  anotherNight: boolean;
}

/** Sleep until the inn's wake-up hour, then pay (the original charges after the night, not before). */
export function sleepAtInn(
  world: WorldState,
  party: PartyState,
  stats: Pick<ShopStats, 'innSleepUntilHour'>,
  cost: number,
  rule?: (item: number) => ItemRule | undefined,
): NightResult {
  const r = rest(world, party, { inInn: true, untilHour: stats.innSleepUntilHour, rule });
  const paid = loseRoyals(r.party, cost);
  return {
    world: r.world,
    party: paid,
    hours: r.hours,
    anotherNight: activeCharacters(paid).some((c) => canHeal(c, true)),
  };
}

export interface InnDeps {
  /** Stats of the inn at a scene, if it has any. */
  stats(ref: GdsRef): ShopStats | undefined;
  chapter(): number;
  world(): WorldState;
  setWorld(w: WorldState): void;
  party(): PartyState;
  setParty(p: PartyState): void;
  /** Play a dialogue and call `done` when it ends. */
  playDialog(key: number, done: (end: DialogEnd) => void): void;
  itemRule?(item: number): ItemRule | undefined;
  /** Short message for the player ("You slept 8 hours."). */
  notify(message: string): void;
}

/** Runs the innkeeper's offer and the nights the party takes up. */
export function createInnHost(d: InnDeps) {
  const offer = (stats: ShopStats, haveSlept: boolean): void => {
    const cost = innCostRoyals(stats, d.chapter(), d.world());
    const party = d.party();
    Object.assign(scriptedState, { context: haveSlept ? 1 : 0, itemValue: cost, gold: party.gold });
    d.playDialog(INN_DIALOG_KEY, (end) => {
      scriptedState.reset();
      if (!acceptedOffer(end)) return;
      const now = d.party();
      if (now.gold < cost) {
        d.notify('You cannot afford a room.');
        return;
      }
      const night = sleepAtInn(d.world(), now, stats, cost, d.itemRule);
      d.setWorld(night.world);
      d.setParty(night.party);
      playSfx(Snd.buy);
      d.notify(`You slept for ${night.hours} hour${night.hours === 1 ? '' : 's'}.`);
      if (night.anotherNight) offer(stats, true);
    });
  };
  return {
    /** The party clicked an inn hotspot in this scene. */
    enter(ref: GdsRef): void {
      const stats = d.stats(ref);
      if (!stats) {
        d.notify('This inn has no rooms.');
        return;
      }
      offer(stats, false);
    },
  };
}
