import { describe, expect, it } from 'vitest';
import { enemyTurn } from '../src/combat/ai';
import { attack, currentFighter, isOver, startBattle, type Fighter } from '../src/combat/battle';
import { Direction } from '../src/combat/grid';
import { RaceKind } from '../src/combat/rules';
import { applyRewards, battleRewards } from '../src/combat/rewards';
import { applyBattleToParty } from '../src/combat/setup';
import { ActionType, parseDDX } from '../src/formats/ddx';
import { ContainerFlag, findShop, parseShopContainers } from '../src/formats/gdsContainers';
import { SKILL_NAMES, type Character, type Skill } from '../src/formats/gam';
import { ItemType, type ItemDef } from '../src/formats/objinfo';
import { CELL_SIZE, TILE_SIZE } from '../src/formats/world';
import { ContainerStore, nearestContainer, openedFlagUpdate, takeAll, type WorldContainer } from '../src/game/containers';
import { resolveDialogOutcome } from '../src/game/dialogOutcome';
import { DialogSession, DialogStore, QUERY_NO, QUERY_YES } from '../src/game/encounterRunner';
import { activeCharacters, type PartyState } from '../src/game/party';
import { MemorySaveStore, SaveGames, type SaveGameData } from '../src/game/saveGame';
import { captureSaveExtras, registerSaveExtra, restoreSaveExtras } from '../src/game/saveExtras';
import { ItemFlag, buy, priceOf, sell, shopFromContainer, type PriceContext } from '../src/game/shops';
import { getFlag, type WorldState } from '../src/game/state';
import { destinationAt, planTransition, type Destination, type ZoneTransition } from '../src/game/transitions';

/**
 * Chapter 1 critical path over hand-built data, no browser and no game files: start, a first
 * dialogue, a town, a shop purchase, a combat, a chest, a zone transition, save and load. Each step
 * feeds the next through the same pure modules the game composes, so a regression in any hand-off
 * (dialogue to party, party to shop, battle to party, container to flags, all of it to the save)
 * breaks this test.
 */

// ---- synthetic data --------------------------------------------------------------------------

const ITEM_SWORD = 1;
const ITEM_RATIONS = 3;
const ITEM_KEY = 4;
const ITEM_GEM = 6;
const FLAG_MET_INNKEEPER = 0x300;
const FLAG_CHEST_OPENED = 0x301;
const ZONE_VILLAGE = 1;
const ZONE_TOWN = 2;
const ZONE_ROAD = 3;

const DEFS: ItemDef[] = [];
const def = (index: number, o: Partial<ItemDef>) =>
  (DEFS[index] = { index, name: `Item ${index}`, value: 100, stackSize: 1, defaultStackSize: 1, flags: 0, categories: 0, type: 0, ...o } as ItemDef);
def(ITEM_SWORD, { name: 'Sword', value: 100, type: ItemType.Sword, categories: 0x0080 });
def(ITEM_RATIONS, { name: 'Rations', value: 10, type: ItemType.Ration, categories: 0x0002, flags: ItemFlag.Stackable, stackSize: 10, defaultStackSize: 5 });
def(ITEM_KEY, { name: 'Key', type: ItemType.Key });
def(ITEM_GEM, { name: 'Gem', value: 50, categories: 0x0400 });
def(53, { name: 'Sovereigns', value: 200, stackSize: 255 });
def(54, { name: 'Royals', value: 1, stackSize: 255 });
const PRICES: PriceContext = { scrollValues: [] };

const skill = (max: number, trueSkill: number): Skill => ({ max, trueSkill, current: 0, experience: 0, modifier: 0, selected: false, unseenImprovement: false });

function character(index: number, name: string): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  Object.assign(skills, {
    health: skill(40, 40), stamina: skill(30, 30), speed: skill(9, 9), strength: skill(12, 12), defense: skill(30, 30),
    melee: skill(80, 80), haggling: skill(50, 50), lockpick: skill(40, 40),
  });
  return {
    index, name, unknownHeader: new Uint8Array(2), spellBytes: new Uint8Array(6), spells: [], skills, combatCharIndex: 0, unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 0 },
    affectors: [], inventory: { capacity: 8, items: [] },
  };
}

const startParty = (): PartyState => ({
  gold: 150, characters: [character(0, 'Owyn'), character(1, 'Pug')], activeCharacters: [0, 1], partyKeys: { capacity: 8, items: [] },
});
const startWorld = (): WorldState => ({ chapter: 1, ticks: 6 * 0x708, ticksLastSlept: 0, bytes: new Uint8Array(0x4000), expiringEvents: [] });

/** A one-snippet dialogue (key 1) with an optional Yes/No query and the given actions. */
function dialogue(actions: { type: number; words: number[] }[], world: WorldState, query = false): DialogSession {
  const header = 9;
  const size = header + (query ? 20 : 0) + actions.length * 10 + 1;
  const out = new Uint8Array(10 + size);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 1, true);
  dv.setUint32(2, 1, true);
  dv.setUint32(6, 10, true);
  const p = 10;
  dv.setUint8(p + 4, query ? 2 : 0);
  dv.setUint8(p + 5, query ? 2 : 0);
  dv.setUint8(p + 6, actions.length);
  dv.setUint16(p + 7, 1, true);
  let q = p + header;
  if (query) {
    dv.setUint16(q, QUERY_YES, true);
    dv.setUint16(q + 4, 0xffff, true);
    dv.setUint16(q + 10, QUERY_NO, true);
    dv.setUint16(q + 14, 0xffff, true);
    q += 20;
  }
  for (const a of actions) {
    dv.setUint16(q, a.type, true);
    a.words.forEach((w, k) => dv.setUint16(q + 2 + k * 2, w, true));
    q += 10;
  }
  out[q] = 'x'.charCodeAt(0);
  const s = new DialogSession(new DialogStore(new Map([[1, parseDDX(out)]])), world);
  s.start(1);
  return s;
}

/** The village's shop as the game stores it: one container record with a stock list and shop stats. */
function shopBytes(): Uint8Array {
  const stats = [3, 20, 30, 50, 40, 25, 0, 0, 0, 0, 8, 12, 5, 9, 0x80, 0x02];
  const item = (index: number, quantity: number) => [index, quantity, 0, 0];
  return new Uint8Array([0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 7, 2, 4, ContainerFlag.Shop, ...item(ITEM_SWORD, 100), ...item(ITEM_RATIONS, 10), 0, 0, 0, 0, 0, 0, 0, 0, ...stats]);
}

const chestInRoad = (): WorldContainer => ({
  id: `${ZONE_ROAD}:0`, zone: ZONE_ROAD, x: 5000, y: 5000, model: 3, fromChapter: 1, toChapter: 9, capacity: 4,
  items: [{ itemIndex: ITEM_GEM, conditionOrQuantity: 100, status: 0, modifiers: 0 }, { itemIndex: 54, conditionOrQuantity: 25, status: 0, modifiers: 0 }],
  unlocked: false, trapSpent: false, setFlag: FLAG_CHEST_OPENED,
});

const fighter = (id: string, side: 'party' | 'enemy', x: number, y: number, over: Partial<Fighter> = {}): Fighter => ({
  id, side, name: id, monster: 0, pos: { x, y }, facing: Direction.North,
  health: 20, maxHealth: 20, stamina: 10, maxStamina: 10, speed: 5, strength: 8, defense: 0, melee: 90, race: RaceKind.None, ...over,
});

// ---- the journey -----------------------------------------------------------------------------

describe('chapter 1 critical path', () => {
  it('plays from the first dialogue to a save that loads back identical', async () => {
    // 1. Start: chapter 1, two heroes, 150 royals, standing in the village.
    let world = startWorld();
    let party = startParty();
    let zone = ZONE_VILLAGE;
    let pos = { x: 100, y: 200, heading: 0 };
    expect(world.chapter).toBe(1);
    expect(activeCharacters(party).map((c) => c.name)).toEqual(['Owyn', 'Pug']);

    // 2. First dialogue: the innkeeper offers rations and a sovereign; accepting hands them over and sets a flag.
    const hello = dialogue([
      { type: ActionType.GiveItem, words: [ITEM_RATIONS, 5, 0, 0] },
      { type: ActionType.GiveItem, words: [53, 1, 0, 0] },
      { type: ActionType.SetFlag, words: [FLAG_MET_INNKEEPER, 0, 0, 1] },
    ], world, true);
    expect(hello.view?.mode).toBe('query');
    expect(hello.view?.options.map((o) => o.value)).toEqual([QUERY_YES, QUERY_NO]);
    hello.choose(QUERY_YES);
    expect(hello.done).toBe(true);
    const gift = resolveDialogOutcome({ session: hello, party, items: DEFS });
    world = gift.world;
    party = gift.party;
    expect(getFlag(world, FLAG_MET_INNKEEPER)).toBe(true);
    expect(party.gold).toBe(150 + 10); // a sovereign is worth 10 royals
    expect(gift.lostItems).toEqual([]);
    expect(activeCharacters(party).flatMap((c) => c.inventory.items).some((i) => i.itemIndex === ITEM_RATIONS)).toBe(true);

    // 3. A town: the village gate asks "enter?" and, on Yes, leads to the town zone and its shop scene.
    const townGate: ZoneTransition = { ...destinationAt(ZONE_TOWN, 2, 3, 4, 4, 0x4000), dialog: 1, hotspot: 7, hotspotChar: 0 };
    const gate = dialogue([], world, true);
    gate.choose(QUERY_YES);
    const entering = resolveDialogOutcome({ session: gate, party, transition: townGate });
    const destination = entering.destination as Destination;
    expect(destination.zone).toBe(ZONE_TOWN);
    let plan = planTransition(zone, destination);
    expect(plan).toMatchObject({ reload: true, zone: ZONE_TOWN, hotspot: 7 });
    expect(plan.x).toBe(2 * TILE_SIZE + 4 * CELL_SIZE + CELL_SIZE / 2);
    zone = plan.zone;
    pos = { x: plan.x, y: plan.y, heading: plan.heading };
    // Saying No stays out.
    const refusal = dialogue([], world, true);
    refusal.choose(QUERY_NO);
    expect(resolveDialogOutcome({ session: refusal, party, transition: townGate }).destination).toBeUndefined();

    // 4. Shop purchase: the stocked sword is bought for Owyn and the royals leave the purse.
    const shop = shopFromContainer(findShop(parseShopContainers(shopBytes(), 0, 1), { number: 2, letter: 'B' })!)!;
    expect(shop.items.map((i) => i.itemIndex)).toEqual([ITEM_SWORD, ITEM_RATIONS]);
    const price = priceOf(shop, shop.items[0]!, DEFS[ITEM_SWORD]!, PRICES)!;
    expect(price).toBeGreaterThan(0);
    const bought = buy(party, shop, ITEM_SWORD, 0, DEFS, PRICES);
    expect(bought).toMatchObject({ ok: true });
    if (!bought.ok) throw new Error('purchase refused');
    expect(bought.price).toBe(price);
    party = bought.result.party;
    expect(party.gold).toBe(160 - price);
    const owyn = () => party.characters.find((c) => c.index === 0)!;
    const swordSlot = owyn().inventory.items.findIndex((i) => i.itemIndex === ITEM_SWORD);
    expect(swordSlot).toBeGreaterThanOrEqual(0);
    // Selling it back returns royals; a purse too small to buy is refused with a reason.
    const resold = sell(party, bought.result.shop, 0, swordSlot, DEFS, PRICES);
    expect(resold.ok).toBe(true);
    const broke = buy({ ...party, gold: 0 }, shop, ITEM_SWORD, 0, DEFS, PRICES);
    expect(broke).toEqual({ ok: false, reason: 'cantAfford' });

    // 5. Combat on the road: a sure-hit roll, the party wins, gets paid and hurt.
    zone = ZONE_ROAD;
    let battle = startBattle([
      fighter('party0', 'party', 3, 1, { speed: 9, health: 40, maxHealth: 40 }),
      fighter('party1', 'party', 4, 1, { speed: 8, health: 40, maxHealth: 40 }),
      fighter('enemy1', 'enemy', 3, 2, { speed: 1, health: 8, maxHealth: 8, strength: 2, defense: 0 }),
    ]);
    const low = (lo: number) => lo;
    for (let turns = 0; !isOver(battle) && turns < 50; turns++) {
      const me = currentFighter(battle);
      if (me.side === 'enemy') {
        battle = enemyTurn(battle, low);
        continue;
      }
      const target = battle.fighters.find((f) => f.side === 'enemy' && f.health > 0)!;
      battle = attack(battle, target.pos, low) ?? battle;
    }
    expect(isOver(battle)).toBe(true);
    expect(battle.turn.outcome).toBeDefined();
    expect(battle.fighters.find((f) => f.id === 'enemy1')!.health).toBeLessThanOrEqual(0);
    const before = party;
    const rewards = battleRewards(battle.fighters, battle.history, (lo) => lo);
    party = applyRewards(applyBattleToParty(party, battle.fighters), rewards);
    expect(rewards.experience.size).toBeGreaterThan(0);
    expect(party.characters.every((c) => c.skills.health.trueSkill > 0 && c.skills.health.trueSkill <= before.characters[0]!.skills.health.trueSkill)).toBe(true);
    expect(party.gold).toBeGreaterThanOrEqual(before.gold);

    // 6. A chest: step up to it, open it, take everything; its flag is set and the loot is the party's.
    const store = new ContainerStore((z) => (z === ZONE_ROAD ? [chestInRoad()] : []));
    registerSaveExtra('journeyContainers', { capture: () => store.snapshot(), restore: (d) => store.restore(d as never) });
    pos = { x: 4900, y: 4800, heading: 64 };
    const chest = nearestContainer(store.zone(ZONE_ROAD), pos.x, pos.y, world.chapter, world)!;
    expect(chest.id).toBe(`${ZONE_ROAD}:0`);
    const goldBefore = party.gold;
    const looted = takeAll(party, chest, DEFS);
    expect(looted.left).toBe(0);
    party = looted.party;
    store.replace({ ...looted.container, unlocked: true });
    world = openedFlagUpdate(chest, world);
    expect(getFlag(world, FLAG_CHEST_OPENED)).toBe(true);
    expect(party.gold).toBe(goldBefore + 25);
    expect(activeCharacters(party).flatMap((c) => c.inventory.items).some((i) => i.itemIndex === ITEM_GEM)).toBe(true);
    expect(store.snapshot()[chest.id]).toMatchObject({ items: [], unlocked: true });

    // 7. Zone transition: a signpost dialogue on the road sends the party back to the village.
    const home = dialogue([{ type: ActionType.Teleport, words: [0] }], world);
    const leaving = resolveDialogOutcome({ session: home, party, teleports: [destinationAt(ZONE_VILLAGE, 0, 0, 2, 2, 0x8000)] });
    plan = planTransition(zone, leaving.destination!);
    expect(plan).toMatchObject({ reload: true, zone: ZONE_VILLAGE, heading: 0x80 });
    zone = plan.zone;
    pos = { x: plan.x, y: plan.y, heading: plan.heading };

    // 8. Save and load: everything above survives a round trip through the store, chest included.
    const games = new SaveGames(new MemorySaveStore());
    const data: SaveGameData = { savedAt: 1, zone, x: pos.x, y: pos.y, heading: pos.heading, world, party, extras: captureSaveExtras() };
    await games.save('quick', data);
    store.restore(undefined); // a new session knows nothing of the opened chest
    expect(store.zone(ZONE_ROAD)[0]!.items).toHaveLength(2);

    const loaded = (await games.load('quick'))!;
    restoreSaveExtras(loaded.extras);
    expect(loaded.zone).toBe(ZONE_VILLAGE);
    expect([loaded.x, loaded.y, loaded.heading]).toEqual([pos.x, pos.y, pos.heading]);
    expect(loaded.party).toEqual(party);
    expect(loaded.party.gold).toBe(party.gold);
    expect(getFlag(loaded.world, FLAG_MET_INNKEEPER)).toBe(true);
    expect(getFlag(loaded.world, FLAG_CHEST_OPENED)).toBe(true);
    expect(loaded.world.ticks).toBe(world.ticks);
    expect(store.zone(ZONE_ROAD)[0]).toMatchObject({ items: [], unlocked: true });
    const summary = (await games.list()).find((s) => s.slot === 'quick')!.summary!;
    expect(summary).toMatchObject({ zone: ZONE_VILLAGE, gold: party.gold, members: ['Owyn', 'Pug'] });
  });
});
