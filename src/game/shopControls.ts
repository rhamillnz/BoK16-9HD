import '../ui/shopHudScreen'; // registers the 'shop' HUD screen
import { playSfx } from '../audio/sfxBus';
import { Snd } from '../audio/soundIds';
import type { InventoryItem } from '../formats/gam';
import { parseShopContainers, type ShopStats } from '../formats/gdsContainers';
import type { GdsRef } from '../formats/gds';
import type { ItemDef } from '../formats/objinfo';
import type { ShopHudScreen, ShopView } from '../ui/shopHudScreen';
import type { ShopModel, ShopRow } from '../ui/shopScreen';
import { activeCharacters, updateCharacter, type PartyState } from './party';
import { REPAIR_DIALOG, canShopRepair, needsRepair, repairCost, repaired } from './repairShop';
import { BARD_SONG, performBard } from './bard';
import {
  ItemFlag,
  UNPURCHASEABLE,
  applyHaggle,
  buy,
  buyPrice,
  canBuyItem,
  defaultRng,
  haggle,
  haggleSkill,
  isRefused,
  isRomneyGuildWars,
  offeredItem,
  priceOf,
  sell,
  shopFromContainer,
  type PriceContext,
  type Refusal,
  type Rng,
  type ShopState,
} from './shops';
import { practiceCharacter } from './practice';
import type { WorldState } from './state';
import type { TextVariableContext } from './textVariables';

/** Dialogue keys the original's shop screen plays (see docs/formats/shops.md). */
export const SHOP_DIALOG = {
  failHaggle: 0x1b7754,
  succeedHaggle: 0x1b7755,
  sell: 0x1b7756,
  buy: 0x1b7757,
  cantAfford: 0x1b7758,
  wontBuy: 0x1b7759,
  tooDrunk: 0x1b775c,
  cantHaggleScroll: 0x1b775f,
  noRoom: 0x1b7748,
  onlyWeapon: 0x1b774e,
} as const;

/** Query answers of the buy and sell dialogues (KEYWORD.DAT). */
export const ANSWER_ACCEPT = 0x104;
export const ANSWER_HAGGLE = 0x106;

export interface ShopDialogEnd {
  cancelled: boolean;
  /** The query answer picked last, if any. */
  choice?: number;
}

/** What the HUD must offer: open the shop screen and hand it a view. */
export interface ShopHud {
  open(id: string, arg?: unknown): void;
  screenHandler<T extends ShopHudScreen>(id: string): T;
}

export interface ShopHost {
  items: readonly ItemDef[];
  /** OBJINFO's trailing scroll price table. */
  scrollValues: readonly number[];
  /** The save image the shop containers are read from. */
  saveBytes: Uint8Array;
  hud: ShopHud;
  getParty(): PartyState;
  setParty(p: PartyState): void;
  getWorld(): WorldState;
  zone(): number;
  /** Play the dialogue at `key` and call `done` when it ends. */
  playDialog(key: number, done: (end: ShopDialogEnd) => void): void;
  rng?: Rng;
  /** Current chapter (barding pays more in later chapters). Default 1. */
  chapter?(): number;
  /** Play a song while a performance is answered, and bring back what was playing (the bard's tune). */
  playSong?(song: number): () => void;
}

/** Saved shop state: what the shop stocks and its statistics, by scene name ("2B"). */
export type ShopSave = Record<string, { items: InventoryItem[]; stats: ShopStats }>;

/** "2 sov 5 roy"; 10 royals make a sovereign. */
export function formatRoyals(royals: number): string {
  const sov = Math.floor(royals / 10);
  const roy = royals % 10;
  if (sov === 0) return `${roy} roy`;
  return roy === 0 ? `${sov} sov` : `${sov} sov ${roy} roy`;
}

const sceneKey = (ref: GdsRef) => `${ref.number}${ref.letter}`;

/** Shops of the running game: stock changes (sold items), haggling state for the visit, and the shop screen. */
export function createShops(host: ShopHost) {
  const rng = host.rng ?? defaultRng;
  const book = new Map<string, ShopState>();
  for (const c of parseShopContainers(host.saveBytes)) {
    const s = shopFromContainer(c);
    if (s) book.set(sceneKey(c.ref), s);
  }
  // Dialogue text variables for the transaction being talked about (price, item, who is buying).
  let extras: Partial<TextVariableContext> = {};

  const defOf = (i: InventoryItem): ItemDef | undefined => host.items[i.itemIndex];
  const ctx = (shop: ShopState): PriceContext => ({
    scrollValues: host.scrollValues,
    romneyGuildWars: isRomneyGuildWars(shop.stats, host.zone(), host.getWorld()),
  });
  const nameOf = (i: InventoryItem, d: ItemDef) =>
    (d.flags & (ItemFlag.Stackable | ItemFlag.ChargeBased | ItemFlag.QuantityBased)) !== 0
      ? `${d.name} (${i.conditionOrQuantity})`
      : d.name;

  const play = (key: number) => new Promise<ShopDialogEnd>((resolve) => host.playDialog(key, resolve));

  async function enter(ref: GdsRef): Promise<boolean> {
    const key = sceneKey(ref);
    const stored = book.get(key);
    if (!stored) return false;
    let shop: ShopState = { ...stored, discounts: {} };
    const screen = host.hud.screenHandler<ShopHudScreen>('shop');
    const members = () => activeCharacters(host.getParty());
    const memberIndex = (m: number) => members()[m]?.index;

    const model = (m: number): ShopModel => {
      const party = host.getParty();
      const who = members()[m];
      const c = ctx(shop);
      const stock: ShopRow[] = shop.items.flatMap((item) => {
        const d = defOf(item);
        if (!d) return [];
        const price = priceOf(shop, item, d, c);
        return [
          {
            label: nameOf(offeredItem(item, d), d),
            price: price === undefined ? 'sold' : formatRoyals(price),
            dim: price === undefined,
          },
        ];
      });
      const pack: ShopRow[] = (who?.inventory.items ?? []).flatMap((item) => {
        const d = defOf(item);
        if (!d) return [];
        const wanted = canBuyItem(shop, item, d);
        return [
          { label: nameOf(item, d), price: wanted ? formatRoyals(buyPrice(item, d, shop.stats, c)) : '', dim: !wanted },
        ];
      });
      return {
        title: 'Shop',
        purse: `Purse: ${formatRoyals(party.gold)}`,
        members: members().map((x) => x.name),
        stock,
        pack,
      };
    };

    const reopen = (message = '') => {
      host.hud.open('shop');
      screen.setMessage(message);
    };

    const refuse = async (reason: Refusal, price = 0, itemName = ''): Promise<void> => {
      extras = { itemValue: price, itemName };
      const keyFor: Partial<Record<Refusal, number>> = {
        cantAfford: SHOP_DIALOG.cantAfford,
        tooDrunk: SHOP_DIALOG.tooDrunk,
        noRoom: SHOP_DIALOG.noRoom,
        wontBuy: SHOP_DIALOG.wontBuy,
        onlyWeapon: SHOP_DIALOG.onlyWeapon,
      };
      const k = keyFor[reason];
      if (k !== undefined) await play(k);
    };

    const doBuy = async (stockIndex: number, m: number): Promise<void> => {
      const item = shop.items[stockIndex];
      const who = memberIndex(m);
      const d = item && defOf(item);
      if (!item || !d || who === undefined) return;
      const c = ctx(shop);
      if (isRefused(shop, item.itemIndex)) return reopen('The shopkeeper will not sell that.');
      const trial = buy(host.getParty(), shop, item.itemIndex, who, host.items, c);
      const price = priceOf(shop, item, d, c) ?? 0;
      extras = { itemValue: price, itemName: d.name, activeCharacter: who };
      if (!trial.ok) {
        await refuse(trial.reason, price, d.name);
        return reopen();
      }
      const end = await play(SHOP_DIALOG.buy);
      if (end.cancelled || end.choice === undefined) return reopen();
      if (end.choice === ANSWER_HAGGLE) return doHaggle(stockIndex, m);
      if (end.choice !== ANSWER_ACCEPT) return reopen();
      const done = buy(host.getParty(), shop, item.itemIndex, who, host.items, c);
      if (!done.ok) return reopen(); // the party changed during the dialogue
      host.setParty(done.result.party);
      shop = done.result.shop;
      playSfx(Snd.buy);
      reopen(`Bought ${d.name} for ${formatRoyals(done.price)}`);
    };

    const doHaggle = async (stockIndex: number, m: number): Promise<void> => {
      const item = shop.items[stockIndex];
      const who = memberIndex(m);
      const d = item && defOf(item);
      if (!item || !d || who === undefined) return;
      extras = { itemName: d.name, activeCharacter: who };
      const r = haggle(shop, d, haggleSkill(host.getParty(), who), rng);
      shop = applyHaggle(shop, item.itemIndex, r);
      if (r.exercised) host.setParty(practiceCharacter(host.getParty(), who, 'haggling'));
      if (r.outcome === 'discount') {
        await play(SHOP_DIALOG.succeedHaggle);
        return doBuy(stockIndex, m); // offer the item again at the new price
      }
      await play(r.outcome === 'scroll' ? SHOP_DIALOG.cantHaggleScroll : SHOP_DIALOG.failHaggle);
      reopen(r.discount === UNPURCHASEABLE ? 'The shopkeeper will not sell that now.' : '');
    };

    const doSell = async (slot: number, m: number): Promise<void> => {
      const who = memberIndex(m);
      if (who === undefined) return;
      const c = ctx(shop);
      const trial = sell(host.getParty(), shop, who, slot, host.items, c);
      const item = members()[m]?.inventory.items[slot];
      const d = item && defOf(item);
      if (!trial.ok) {
        if (trial.reason === 'cantSellKey') return reopen('Keys cannot be sold.');
        await refuse(trial.reason, 0, d?.name ?? '');
        return reopen();
      }
      extras = { itemValue: trial.price, itemName: d?.name ?? '', activeCharacter: who };
      const end = await play(SHOP_DIALOG.sell);
      if (end.cancelled || end.choice !== ANSWER_ACCEPT) return reopen();
      const done = sell(host.getParty(), shop, who, slot, host.items, c);
      if (!done.ok) return reopen();
      host.setParty(done.result.party);
      shop = done.result.shop;
      playSfx(Snd.buy);
      reopen(`Sold ${d?.name ?? 'item'} for ${formatRoyals(done.price)}`);
    };

    const view: ShopView = {
      model,
      act: (r, m) => {
        if (r.kind === 'buy') void doBuy(r.stock, m);
        else if (r.kind === 'haggle') void doHaggle(r.stock, m);
        else void doSell(r.pack, m);
      },
      closed: () => {
        book.set(key, { ...shop, discounts: {} }); // keep sold items; haggling ends with the visit
        extras = {};
      },
    };
    screen.setView(view);
    host.hud.open('shop', { fresh: true });
    return true;
  }

  /** The mender of a scene: the shop screen lists each member's pack with repair prices; a click asks for a repair. */
  function repair(ref: GdsRef): boolean {
    const shop = book.get(sceneKey(ref));
    if (!shop) return false;
    const stats = shop.stats;
    const screen = host.hud.screenHandler<ShopHudScreen>('shop');
    const members = () => activeCharacters(host.getParty());
    const HINT = 'Click an item to have it mended, Esc leaves';
    const reopen = (message = HINT) => {
      host.hud.open('shop');
      screen.setMessage(message);
    };

    const model = (m: number): ShopModel => {
      const party = host.getParty();
      const pack: ShopRow[] = (members()[m]?.inventory.items ?? []).flatMap((item) => {
        const d = defOf(item);
        if (!d) return [];
        const mendable = canShopRepair(d, stats) && needsRepair(item);
        return [
          {
            label: nameOf(item, d),
            price: mendable ? formatRoyals(repairCost(item, d, stats)) : '',
            dim: !mendable,
          },
        ];
      });
      return {
        title: 'Repairs',
        purse: `Purse: ${formatRoyals(party.gold)}`,
        members: members().map((x) => x.name),
        stock: [],
        pack,
      };
    };

    const doRepair = async (slot: number, m: number): Promise<void> => {
      const who = members()[m];
      const item = who?.inventory.items[slot];
      const d = item && defOf(item);
      if (!who || !item || !d) return reopen();
      const cost = repairCost(item, d, stats);
      extras = { itemName: d.name, itemValue: cost, activeCharacter: who.index };
      if (!canShopRepair(d, stats)) {
        await play(REPAIR_DIALOG.cantRepair);
        return reopen();
      }
      if (!needsRepair(item)) {
        await play(REPAIR_DIALOG.notNeeded);
        return reopen();
      }
      const end = await play(REPAIR_DIALOG.cost);
      if (end.cancelled || end.choice !== ANSWER_ACCEPT) return reopen();
      const party = host.getParty();
      const still = party.characters.find((c) => c.index === who.index)?.inventory.items[slot];
      if (still?.itemIndex !== item.itemIndex) return reopen(); // the pack changed during the dialogue
      if (party.gold <= cost) {
        await play(SHOP_DIALOG.cantAfford);
        return reopen();
      }
      const next = updateCharacter({ ...party, gold: party.gold - cost }, who.index, (c) => ({
        ...c,
        inventory: { ...c.inventory, items: c.inventory.items.map((x, i) => (i === slot ? repaired(x) : x)) },
      }));
      host.setParty(next);
      playSfx(Snd.buy);
      reopen(`Repaired ${d.name} for ${formatRoyals(cost)}`);
    };

    screen.setView({
      model,
      act: (r, m) => {
        if (r.kind === 'sell') void doRepair(r.pack, m);
      },
      closed: () => {
        extras = {};
      },
    });
    host.hud.open('shop', { fresh: true });
    screen.setMessage(HINT);
    return true;
  }

  return {
    /** Open the shop of a scene; false when the save has no shop there. */
    enter,
    /** Open the mender of a scene; false when the scene has no shop record. */
    repair,
    /** Open the shop of a scene without waiting; false when the scene has none. */
    open(ref: GdsRef): boolean {
      if (!book.has(sceneKey(ref))) return false;
      void enter(ref);
      return true;
    },
    /**
     * The inn's Lute hotspot: the best bard plays, the purse and practice are applied and the innkeeper answers.
     * Resolves 'thrownOut' after a failed performance (the party has to leave), else 'played'; 'none' when the
     * scene has no inn.
     */
    async bard(ref: GdsRef): Promise<'played' | 'thrownOut' | 'none'> {
      const key = sceneKey(ref);
      const shop = book.get(key);
      if (!shop) return 'none';
      const r = performBard(host.getParty(), shop.stats, host.chapter?.() ?? 1);
      book.set(key, { ...shop, stats: r.stats });
      host.setParty(r.party);
      const stopSong = r.status ? host.playSong?.(BARD_SONG[r.status]) : undefined;
      extras = { itemValue: r.reward, ...(r.bard ? { activeCharacter: r.bard.index } : {}) };
      await new Promise<void>((done) => host.playDialog(r.dialog, () => done()));
      extras = {};
      stopSong?.();
      return r.status === 'failed' ? 'thrownOut' : 'played';
    },
    /** Extra values for dialogue text (`@` price, item and character) while a shop talks. */
    textExtras: (): Partial<TextVariableContext> => extras,
    /** A scene's shop statistics, or undefined when it has no shop. */
    stats(ref: GdsRef): ShopStats | undefined {
      return book.get(sceneKey(ref))?.stats;
    },
    /** A shop's (or inn's) stock and capacity, for the chapter-start rules; undefined when the scene has no shop. */
    stock(ref: GdsRef): { capacity: number; items: InventoryItem[] } | undefined {
      const shop = book.get(sceneKey(ref));
      return shop && { capacity: shop.capacity, items: shop.items.map((i) => ({ ...i })) };
    },
    /** Replace a shop's stock (cut to its capacity). */
    setStock(ref: GdsRef, items: readonly InventoryItem[]): void {
      const shop = book.get(sceneKey(ref));
      if (shop) book.set(sceneKey(ref), { ...shop, items: items.slice(0, shop.capacity).map((i) => ({ ...i })) });
    },
    snapshot(): ShopSave {
      return Object.fromEntries([...book].map(([k, s]) => [k, { items: s.items, stats: s.stats }]));
    },
    restore(saved: ShopSave | undefined): void {
      if (!saved) return;
      for (const [k, v] of Object.entries(saved)) {
        const cur = book.get(k);
        if (cur) book.set(k, { ...cur, items: v.items, stats: v.stats, discounts: {} });
      }
    },
  };
}

export type Shops = ReturnType<typeof createShops>;
