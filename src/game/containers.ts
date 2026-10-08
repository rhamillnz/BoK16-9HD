import type { ContainerItem, ContainerLock, ContainerRecord } from '../formats/containers';
import { isTrapped, isWordLock, presentInChapter } from '../formats/containers';
import { ITEM_STATUS_BITS, type Character, type InventoryItem } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { applyDamage } from '../combat/rules';
import { getFlag, setFlag, type WorldState } from './state';
import {
  ITEM_ROYALS,
  ITEM_SOVEREIGNS,
  activeCharacters,
  giveItem,
  updateCharacter,
  type ItemRule,
  type PartyState,
} from './party';

/**
 * Chests, bags and other containers standing in the world. `ContainerStore` holds the live state
 * of every container of the zones visited (items, lock opened, trap spent); the functions here are
 * pure and return new values. See docs/formats/containers.md.
 */

export interface WorldContainer {
  /** Stable name: `zone:index`, the index being the container's position in its zone block. */
  id: string;
  zone: number;
  /** Position in BaK units. */
  x: number;
  y: number;
  model: number;
  fromChapter: number;
  toChapter: number;
  capacity: number;
  items: ContainerItem[];
  lock?: ContainerLock;
  /** The lock has been opened (key, lockpick or riddle). */
  unlocked: boolean;
  /** The trap has been disarmed or has gone off. */
  trapSpent: boolean;
  /** Dialogue key played when the container is closed again. */
  dialogKey?: number;
  /** The container only exists once this event flag is set. */
  requireFlag?: number;
  /** Event flag set when the container is opened. */
  setFlag?: number;
}

/** What changes while playing: everything else is rebuilt from the data. */
export interface ContainerState {
  items: ContainerItem[];
  unlocked: boolean;
  trapSpent: boolean;
}

export type ContainerSnapshot = Record<string, ContainerState>;

/** World containers worth interacting with: not doors, shops or empty placeholders. */
export function worldContainersFromRecords(zone: number, records: readonly ContainerRecord[]): WorldContainer[] {
  const out: WorldContainer[] = [];
  records.forEach((r, index) => {
    if (r.location.kind !== 'world' || r.capacity === 0 || r.door !== undefined || r.shop) return;
    const c: WorldContainer = {
      id: `${zone}:${index}`,
      zone,
      x: r.location.x,
      y: r.location.y,
      model: r.location.model,
      fromChapter: r.location.fromChapter,
      toChapter: r.location.toChapter,
      capacity: r.capacity,
      items: r.items.map((i) => ({ ...i })),
      unlocked: false,
      trapSpent: false,
    };
    if (r.lock) c.lock = { ...r.lock };
    if (r.dialog && r.dialog.key !== 0) c.dialogKey = r.dialog.key;
    if (r.encounter) {
      if (r.encounter.requireEventFlag !== 0) c.requireFlag = r.encounter.requireEventFlag;
      if (r.encounter.setEventFlag !== 0) c.setFlag = r.encounter.setEventFlag;
    }
    out.push(c);
  });
  return out;
}

const stateOf = (c: WorldContainer): ContainerState => ({
  items: c.items,
  unlocked: c.unlocked,
  trapSpent: c.trapSpent,
});
const sameState = (a: ContainerState, b: ContainerState): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Live containers by zone, loaded on first use from `source` (usually the save image). */
export class ContainerStore {
  private zones = new Map<number, WorldContainer[]>();
  private pristine = new Map<string, ContainerState>();
  private pending: ContainerSnapshot = {};

  constructor(private readonly source: (zone: number) => WorldContainer[]) {}

  zone(zone: number): WorldContainer[] {
    let list = this.zones.get(zone);
    if (!list) {
      list = this.source(zone);
      for (const c of list) {
        this.pristine.set(c.id, structuredClone(stateOf(c)));
        const saved = this.pending[c.id];
        if (saved) Object.assign(c, structuredClone(saved));
      }
      this.zones.set(zone, list);
    }
    return list;
  }

  replace(updated: WorldContainer): void {
    const list = this.zone(updated.zone);
    const i = list.findIndex((c) => c.id === updated.id);
    if (i >= 0) list[i] = updated;
  }

  /** Containers whose state differs from the data. */
  snapshot(): ContainerSnapshot {
    const out: ContainerSnapshot = { ...this.pending };
    for (const list of this.zones.values()) {
      for (const c of list) {
        const p = this.pristine.get(c.id);
        if (p && !sameState(p, stateOf(c))) out[c.id] = structuredClone(stateOf(c));
        else delete out[c.id];
      }
    }
    return out;
  }

  /** Go back to the data and apply `snapshot`. Zones reload when next asked for. */
  restore(snapshot: ContainerSnapshot | undefined): void {
    this.zones.clear();
    this.pristine.clear();
    this.pending = snapshot ? structuredClone(snapshot) : {};
  }
}

// ---- Finding and describing ----------------------------------------------------

/** How close (BaK units) the party must stand to a container to open it: a bit under one map cell. */
export const REACH = 1200;

export function visibleIn(c: WorldContainer, chapter: number, world: WorldState): boolean {
  if (chapter < c.fromChapter || chapter > c.toChapter) return false;
  return c.requireFlag === undefined || getFlag(world, c.requireFlag);
}

/** The nearest container within reach that exists in this chapter and world. */
export function nearestContainer(
  list: readonly WorldContainer[],
  x: number,
  y: number,
  chapter: number,
  world: WorldState,
  reach = REACH,
): WorldContainer | undefined {
  let best: WorldContainer | undefined;
  let bestD = reach * reach;
  for (const c of list) {
    if (!visibleIn(c, chapter, world)) continue;
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** A word-lock riddle chest that is still shut. */
export const needsWordLock = (c: WorldContainer): boolean => !!c.lock && isWordLock(c.lock) && !c.unlocked;
/** Locked with a key or picklock: the lock has a rating, is not a riddle and not a trap. */
export const needsKey = (c: WorldContainer): boolean =>
  !!c.lock && !isWordLock(c.lock) && !isTrapped(c.lock) && c.lock.rating !== 0 && !c.unlocked;
/** Still booby-trapped. */
export const isArmed = (c: WorldContainer): boolean =>
  !!c.lock && !isWordLock(c.lock) && isTrapped(c.lock) && c.lock.trapDamage > 0 && !c.trapSpent;

export const openedFlagUpdate = (c: WorldContainer, world: WorldState): WorldState =>
  c.setFlag === undefined ? world : setFlag(world, c.setFlag, true);

// ---- Items ---------------------------------------------------------------------

export const ruleFor = (defs: readonly ItemDef[], itemIndex: number): ItemRule | undefined => {
  const d = defs[itemIndex];
  return d && { stackSize: d.stackSize, defaultStackSize: d.defaultStackSize, isKey: d.type === ItemType.Key };
};

const isStack = (rule: ItemRule | undefined): boolean => (rule?.stackSize ?? 1) > 1;
const isMoney = (itemIndex: number): boolean => itemIndex === ITEM_SOVEREIGNS || itemIndex === ITEM_ROYALS;

export function toInventoryItem(i: ContainerItem): InventoryItem {
  const bit = (n: number) => ((i.status >> n) & 1) === 1;
  return {
    itemIndex: i.itemIndex,
    conditionOrQuantity: i.conditionOrQuantity,
    status: i.status,
    modifiers: i.modifiers,
    activated: bit(ITEM_STATUS_BITS.activated),
    used: bit(ITEM_STATUS_BITS.used),
    broken: bit(ITEM_STATUS_BITS.broken),
    repairable: bit(ITEM_STATUS_BITS.repairable),
    equipped: bit(ITEM_STATUS_BITS.equipped),
    poisoned: bit(ITEM_STATUS_BITS.poisoned),
  };
}

const toContainerItem = (i: InventoryItem): ContainerItem => ({
  itemIndex: i.itemIndex,
  conditionOrQuantity: i.conditionOrQuantity,
  status: i.status,
  modifiers: i.modifiers,
});

/** Put one item with its exact condition into the first character with a free slot; undefined when everyone is full. */
function placeExact(p: PartyState, item: InventoryItem, preferred?: number): PartyState | undefined {
  const order = activeCharacters(p).map((c) => c.index);
  if (preferred !== undefined && order.includes(preferred)) order.unshift(preferred);
  for (const index of order) {
    const c = p.characters.find((x) => x.index === index)!;
    if (c.inventory.items.length >= c.inventory.capacity) continue;
    return updateCharacter(p, index, (x) => ({
      ...x,
      inventory: { ...x.inventory, items: [...x.inventory.items, item] },
    }));
  }
  return undefined;
}

export interface TakeResult {
  party: PartyState;
  container: WorldContainer;
  /** False when nothing moved (no room, or the slot does not exist). */
  moved: boolean;
}

/** Move the item in container slot `slot` to the party: money to the purse, keys to the ring, the rest to a character with room. */
export function takeItem(
  p: PartyState,
  c: WorldContainer,
  slot: number,
  defs: readonly ItemDef[],
  preferred?: number,
): TakeResult {
  const item = c.items[slot];
  if (!item) return { party: p, container: c, moved: false };
  const rule = ruleFor(defs, item.itemIndex);
  let party: PartyState | undefined;
  if (isMoney(item.itemIndex) || rule?.isKey || isStack(rule)) {
    const r = giveItem(
      p,
      item.itemIndex,
      Math.max(1, isStack(rule) || isMoney(item.itemIndex) ? item.conditionOrQuantity : 1),
      rule,
      preferred,
    );
    party = r.lost ? undefined : r.party;
  } else {
    party = placeExact(p, toInventoryItem(item), preferred);
  }
  if (!party) return { party: p, container: c, moved: false };
  return { party, container: { ...c, items: c.items.filter((_, i) => i !== slot) }, moved: true };
}

/** Take everything that fits; items without room stay. */
export function takeAll(
  p: PartyState,
  c: WorldContainer,
  defs: readonly ItemDef[],
  preferred?: number,
): TakeResult & { left: number } {
  let party = p;
  let container = c;
  let moved = false;
  for (let slot = 0; slot < container.items.length;) {
    const r = takeItem(party, container, slot, defs, preferred);
    if (r.moved) {
      party = r.party;
      container = r.container;
      moved = true;
    } else {
      slot++;
    }
  }
  return { party, container, moved, left: container.items.length };
}

export type PutFailure = 'missing' | 'equipped' | 'full';
export type PutResult = { ok: true; party: PartyState; container: WorldContainer } | { ok: false; reason: PutFailure };

/** Move item `slot` of character `characterIndex` into the container; stacks merge into stacks of the same item. */
export function putItem(
  p: PartyState,
  characterIndex: number,
  slot: number,
  c: WorldContainer,
  defs: readonly ItemDef[],
): PutResult {
  const ch = p.characters.find((x) => x.index === characterIndex);
  const item = ch?.inventory.items[slot];
  if (!ch || !item) return { ok: false, reason: 'missing' };
  if (item.equipped) return { ok: false, reason: 'equipped' };
  const rule = ruleFor(defs, item.itemIndex);
  const items = c.items.map((i) => ({ ...i }));
  let left = item.conditionOrQuantity;
  if (isStack(rule)) {
    const max = rule!.stackSize;
    for (const i of items) {
      if (left <= 0 || i.itemIndex !== item.itemIndex || i.conditionOrQuantity >= max) continue;
      const add = Math.min(max - i.conditionOrQuantity, left);
      i.conditionOrQuantity += add;
      left -= add;
    }
    if (left > 0) {
      if (items.length >= c.capacity) return { ok: false, reason: 'full' };
      items.push({ ...toContainerItem(item), conditionOrQuantity: left });
    }
  } else {
    if (items.length >= c.capacity) return { ok: false, reason: 'full' };
    items.push(toContainerItem(item));
  }
  const party = updateCharacter(p, characterIndex, (x) => ({
    ...x,
    inventory: { ...x.inventory, items: x.inventory.items.filter((_, i) => i !== slot) },
  }));
  return { ok: true, party, container: { ...c, items } };
}

// ---- Locks and traps -----------------------------------------------------------

/** The active character with the highest Lockpick skill (first on ties), and that skill. */
export function bestLockpicker(p: PartyState): { character: Character; skill: number } | undefined {
  let best: { character: Character; skill: number } | undefined;
  for (const c of activeCharacters(p)) {
    const skill = c.skills.lockpick.trueSkill + c.skills.lockpick.modifier;
    if (!best || skill > best.skill) best = { character: c, skill };
  }
  return best;
}

/** Percent chance that a character disarms a trap by hand: their Lockpick skill, at most 95. */
export const disarmChance = (skill: number): number => Math.max(5, Math.min(95, skill));

/** A trap goes off: every active character takes `damage` (Stamina first, then Health). */
export function springTrap(p: PartyState, damage: number): PartyState {
  let party = p;
  for (const c of activeCharacters(p)) {
    const pool = applyDamage({ health: c.skills.health.trueSkill, stamina: c.skills.stamina.trueSkill }, damage);
    party = updateCharacter(party, c.index, (x) => ({
      ...x,
      skills: {
        ...x.skills,
        health: { ...x.skills.health, trueSkill: pool.health },
        stamina: { ...x.skills.stamina, trueSkill: pool.stamina },
      },
    }));
  }
  return party;
}

export { presentInChapter };
