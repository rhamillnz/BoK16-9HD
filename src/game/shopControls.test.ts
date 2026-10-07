import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import { SHOPS_OFFSET } from '../formats/gdsContainers';
import { ItemType, type ItemDef } from '../formats/objinfo';
import type { ShopHudScreen, ShopView } from '../ui/shopHudScreen';
import { SHOP_DIALOG, ANSWER_ACCEPT, ANSWER_HAGGLE, createShops, formatRoyals, type ShopDialogEnd } from './shopControls';
import type { PartyState } from './party';
import { TownController } from './townController';
import { HotspotAction, type Hotspot } from '../formats/gds';
import type { TownScene } from './townScene';

const DEFS = [] as ItemDef[];
DEFS[2] = { index: 2, name: 'Plate', value: 500, stackSize: 1, defaultStackSize: 1, flags: 0, categories: 0x200, type: ItemType.Armor } as ItemDef;
DEFS[1] = { index: 1, name: 'Sword', value: 100, stackSize: 1, defaultStackSize: 1, flags: 0, categories: 0x80, type: ItemType.Sword } as ItemDef;

function skill(max: number, trueSkill: number): Skill {
  return { max, trueSkill, current: 0, experience: 0, modifier: 0, selected: false, unseenImprovement: false };
}
function character(index: number): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(60, 60);
  skills.haggling = skill(100, 90);
  return {
    index, name: `C${index}`, unknownHeader: new Uint8Array(2), spellBytes: new Uint8Array(6), spells: [], skills,
    combatCharIndex: 0, unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 0 },
    affectors: [], inventory: { capacity: 4, items: [] },
  };
}

/** One shop container (scene 3B) with a sword in stock. */
function saveBytes(): Uint8Array {
  const bytes = new Uint8Array(SHOPS_OFFSET + 200);
  const shop = [0, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 7, 1, 2, 0x04, 1, 100, 0, 0, 0, 0, 0, 0,
    /* stats */ 1, 20, 30, 50, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x80, 0];
  bytes.set(shop, SHOPS_OFFSET);
  return bytes;
}

function setup(answers: (number | undefined)[], rng: (n: number) => number = () => 0) {
  let party: PartyState = { gold: 500, characters: [character(0), character(1)], activeCharacters: [0, 1], partyKeys: { capacity: 4, items: [] } };
  const played: number[] = [];
  const opened: string[] = [];
  const messages: string[] = [];
  let view: ShopView | undefined;
  const screen = {
    setView: (v: ShopView | undefined) => { view = v; },
    setMessage: (m: string) => messages.push(m),
  } as unknown as ShopHudScreen;
  const shops = createShops({
    items: DEFS, scrollValues: [], saveBytes: saveBytes(), getParty: () => party, setParty: (p) => { party = p; },
    getWorld: () => ({ chapter: 1, ticks: 0, ticksLastSlept: 0, bytes: new Uint8Array(0x4000), expiringEvents: [] }), zone: () => 1,
    hud: { open: (id) => opened.push(id), screenHandler: () => screen as never },
    playDialog: (key, done) => { played.push(key); done({ cancelled: false, choice: answers.shift() } as ShopDialogEnd); },
    rng,
  });
  return { shops, party: () => party, played, opened, messages, view: () => view! };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('createShops', () => {
  it('formats money', () => {
    expect(['0 roy', '2 sov', '2 sov 5 roy'].join()).toBe([formatRoyals(0), formatRoyals(20), formatRoyals(25)].join());
  });

  it('opens a scene that has a shop and not one that has none', async () => {
    const t = setup([]);
    expect(t.shops.open({ number: 9, letter: 'A' })).toBe(false);
    expect(t.shops.open({ number: 3, letter: 'B' })).toBe(true);
    await settle();
    expect(t.opened).toEqual(['shop']);
    const m = t.view().model(0);
    expect(m.members).toEqual(['C0', 'C1']);
    expect(m.stock).toEqual([{ label: 'Sword', price: '12 sov', dim: false }]);
  });

  it('buys after the dialogue is accepted', async () => {
    const t = setup([ANSWER_ACCEPT]);
    await t.shops.enter({ number: 3, letter: 'B' });
    t.view().act({ kind: 'buy', stock: 0 }, 1);
    await settle();
    expect(t.played).toEqual([SHOP_DIALOG.buy]);
    expect(t.party().gold).toBe(380);
    expect(t.party().characters[1]!.inventory.items.map((i) => i.itemIndex)).toEqual([1]);
    expect(t.messages.at(-1)).toBe('Bought Sword for 12 sov');
    expect(t.shops.textExtras()).toMatchObject({ itemValue: 120 });
  });

  it('declining the buy dialogue changes nothing', async () => {
    const t = setup([0x105]);
    await t.shops.enter({ number: 3, letter: 'B' });
    t.view().act({ kind: 'buy', stock: 0 }, 0);
    await settle();
    expect(t.party().gold).toBe(500);
  });

  it('haggling plays the success dialogue, then offers the item again at the lower price', async () => {
    const rolls = [80, 10, 10, 5, 5, 5, 50, 0, 0]; // skill roll 80 beats shop roll 5; discount roll 50 clamps to 30%
    const t = setup([ANSWER_HAGGLE, undefined, ANSWER_ACCEPT], () => rolls.shift() ?? 0);
    await t.shops.enter({ number: 3, letter: 'B' });
    t.view().act({ kind: 'buy', stock: 0 }, 0);
    await settle();
    expect(t.played).toEqual([SHOP_DIALOG.buy, SHOP_DIALOG.succeedHaggle, SHOP_DIALOG.buy]);
    expect(t.party().gold).toBe(500 - 84); // 120 royals less 36
  });

  it('a failed haggle plays the failure dialogue and costs nothing', async () => {
    const t = setup([]);
    await t.shops.enter({ number: 3, letter: 'B' });
    t.view().act({ kind: 'haggle', stock: 0 }, 0); // rng 0: the skill roll cannot beat the shop's
    await settle();
    expect(t.played).toEqual([SHOP_DIALOG.failHaggle]);
    expect(t.party().gold).toBe(500);
  });

  it('sells a pack item after the dialogue is accepted and keeps it in stock', async () => {
    const t = setup([ANSWER_ACCEPT, ANSWER_ACCEPT]);
    await t.shops.enter({ number: 3, letter: 'B' });
    t.view().act({ kind: 'buy', stock: 0 }, 0);
    await settle();
    t.view().act({ kind: 'sell', pack: 0 }, 0);
    await settle();
    expect(t.played).toEqual([SHOP_DIALOG.buy, SHOP_DIALOG.sell]);
    expect(t.party().gold).toBe(500 - 120 + 60);
    expect(t.party().characters[0]!.inventory.items).toHaveLength(0);
  });

  it('refuses a sale the shop does not want with the won\'t-buy dialogue', async () => {
    const t = setup([ANSWER_ACCEPT]);
    await t.shops.enter({ number: 3, letter: 'B' });
    const p = t.party();
    p.characters[0]!.inventory.items.push({ itemIndex: 2, conditionOrQuantity: 100, status: 0, modifiers: 0, activated: false, used: false, broken: false, repairable: false, equipped: false, poisoned: false });
    t.view().act({ kind: 'sell', pack: 0 }, 0);
    await settle();
    expect(t.played).toEqual([SHOP_DIALOG.wontBuy]);
  });

  it('saves and restores stock', async () => {
    const t = setup([]);
    const snap = t.shops.snapshot();
    expect(Object.keys(snap)).toEqual(['3B']);
    t.shops.restore({ '3B': { ...snap['3B']!, items: [] } });
    await t.shops.enter({ number: 3, letter: 'B' });
    expect(t.view().model(0).stock).toEqual([]);
  });
});

describe('TownController shop hotspots', () => {
  const hotspot = { index: 0, action: HotspotAction.Shop, arg3: 0, tooltip: 0 } as unknown as Hotspot;
  const scene = { ref: { number: 3, letter: 'B' } } as TownScene;
  const make = (shop: (() => boolean) | undefined) => {
    const calls: string[] = [];
    const c = new TownController({
      load: async () => scene, show: () => {}, hide: () => {}, playDialog: () => {}, activeHotspots: () => [], left: () => {},
      shop: shop && (() => { calls.push('shop'); return shop(); }),
      unsupported: () => calls.push('unsupported'),
    });
    return { c, calls };
  };
  it('opens the shop, falling back to unsupported when there is none', async () => {
    for (const [shop, expected] of [[() => true, ['shop']], [() => false, ['shop', 'unsupported']], [undefined, ['unsupported']]] as const) {
      const { c, calls } = make(shop);
      await c.enter(scene.ref);
      c.click(hotspot);
      expect(calls).toEqual(expected);
    }
  });
});
