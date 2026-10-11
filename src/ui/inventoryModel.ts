import type { Character, InventoryItem } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { ITEM_PICKLOCK, isKeyItem } from '../game/locks';
import { equipGroup, hasCondition, type EquipGroup } from '../game/itemUse';

/**
 * Pure logic of the list + details inventory: which rows a character shows, filtering and sorting,
 * the comparison against the equipped item, and which action buttons are enabled (and why not).
 * The DOM view lives in `inventoryView.ts`; game rules stay in `itemUse.ts`.
 */

export type InvFilter = 'all' | 'weapons' | 'armour' | 'usable' | 'keys';
export const INV_FILTERS: readonly { id: InvFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'armour', label: 'Armour' },
  { id: 'usable', label: 'Usable' },
  { id: 'keys', label: 'Keys & tools' },
];

export type InvSort = 'name' | 'type' | 'value';
export const INV_SORTS: readonly { id: InvSort; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'type', label: 'Type' },
  { id: 'value', label: 'Value' },
];

export type InvCategory = 'weapon' | 'armour' | 'usable' | 'key' | 'other';
const CATEGORY_ORDER: readonly InvCategory[] = ['weapon', 'armour', 'usable', 'key', 'other'];

export interface InvRow {
  /** Stable id: `pack:<slot>` or `ring:<slot>`. */
  id: string;
  /** A character's own pack, or the party's shared key ring. */
  source: 'pack' | 'ring';
  /** Index into the pack or key ring (what `ItemHandler.act` calls the slot). */
  slot: number;
  item: InventoryItem;
  def: ItemDef | undefined;
  name: string;
  category: InvCategory;
  typeLabel: string;
  /** "87%", "x3" or ''. */
  amount: string;
  equipped: boolean;
  broken: boolean;
  poisoned: boolean;
  value: number;
  imageIndex: number;
}

const TYPE_LABELS: Record<number, string> = {
  [ItemType.Sword]: 'Sword',
  [ItemType.Crossbow]: 'Crossbow',
  [ItemType.Staff]: 'Staff',
  [ItemType.Armor]: 'Armour',
  [ItemType.Key]: 'Key',
  [ItemType.Tool]: 'Tool',
  [ItemType.WeaponOil]: 'Weapon oil',
  [ItemType.ArmorOil]: 'Armour oil',
  [ItemType.SpecialOil]: 'Special oil',
  [ItemType.Bowstring]: 'Bowstring',
  [ItemType.Scroll]: 'Scroll',
  [ItemType.Note]: 'Note',
  [ItemType.Book]: 'Book',
  [ItemType.Potion]: 'Potion',
  [ItemType.Restoratives]: 'Restorative',
  [ItemType.ConditionModifier]: 'Modifier',
  [ItemType.Light]: 'Light',
  [ItemType.Ingredient]: 'Ingredient',
  [ItemType.Ration]: 'Ration',
  [ItemType.Food]: 'Food',
  [ItemType.Other]: 'Item',
};

export function typeLabelOf(def: ItemDef | undefined, itemIndex: number): string {
  if (itemIndex === ITEM_PICKLOCK) return 'Lockpick';
  return (def && TYPE_LABELS[def.type]) || 'Item';
}

export function categoryOf(def: ItemDef | undefined, itemIndex: number, source: 'pack' | 'ring' = 'pack'): InvCategory {
  if (source === 'ring' || itemIndex === ITEM_PICKLOCK || isKeyItem(itemIndex)) return 'key';
  switch (def?.type) {
    case ItemType.Sword:
    case ItemType.Crossbow:
    case ItemType.Staff:
      return 'weapon';
    case ItemType.Armor:
      return 'armour';
    case ItemType.Ration:
    case ItemType.Food:
    case ItemType.Potion:
    case ItemType.Restoratives:
    case ItemType.Scroll:
    case ItemType.Book:
    case ItemType.Note:
      return 'usable';
    case ItemType.Key:
    case ItemType.Tool:
      return 'key';
    default:
      return 'other';
  }
}

function makeRow(item: InventoryItem, slot: number, source: 'pack' | 'ring', defs: readonly ItemDef[]): InvRow {
  const def = defs[item.itemIndex];
  let amount = '';
  if (def && hasCondition(def)) amount = `${item.conditionOrQuantity}%`;
  else if (def && def.stackSize > 1) amount = `x${item.conditionOrQuantity}`;
  return {
    id: `${source}:${slot}`,
    source,
    slot,
    item,
    def,
    name: def?.name ?? `Item ${item.itemIndex}`,
    category: categoryOf(def, item.itemIndex, source),
    typeLabel: typeLabelOf(def, item.itemIndex),
    amount,
    equipped: item.equipped,
    broken: item.broken,
    poisoned: item.poisoned,
    value: def?.value ?? 0,
    imageIndex: def?.imageIndex ?? item.itemIndex,
  };
}

/** The character's pack followed by the party key ring (keys and lockpicks live on the ring). */
export function buildRows(
  character: Character | undefined,
  keyRing: readonly InventoryItem[],
  defs: readonly ItemDef[],
): InvRow[] {
  const rows = (character?.inventory.items ?? []).map((it, i) => makeRow(it, i, 'pack', defs));
  keyRing.forEach((it, i) => rows.push(makeRow(it, i, 'ring', defs)));
  return rows;
}

export function matchesFilter(row: InvRow, filter: InvFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'weapons':
      return row.category === 'weapon';
    case 'armour':
      return row.category === 'armour';
    case 'usable':
      return row.category === 'usable';
    case 'keys':
      return row.category === 'key';
  }
}

const byName = (a: InvRow, b: InvRow) => a.name.localeCompare(b.name) || a.slot - b.slot;

export function sortRows(rows: readonly InvRow[], sort: InvSort): InvRow[] {
  const out = [...rows];
  switch (sort) {
    case 'name':
      return out.sort(byName);
    case 'type':
      return out.sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
          a.typeLabel.localeCompare(b.typeLabel) ||
          byName(a, b),
      );
    case 'value':
      return out.sort((a, b) => b.value - a.value || byName(a, b));
  }
}

/** Rows to show: filtered, then sorted. */
export function visibleRows(rows: readonly InvRow[], filter: InvFilter, sort: InvSort): InvRow[] {
  return sortRows(
    rows.filter((r) => matchesFilter(r, filter)),
    sort,
  );
}

/** Move the selection by `delta` rows (clamped); an unknown or missing id selects the first row. */
export function moveSelection(
  rows: readonly InvRow[],
  selectedId: string | undefined,
  delta: number,
): string | undefined {
  if (rows.length === 0) return undefined;
  const at = rows.findIndex((r) => r.id === selectedId);
  if (at < 0) return rows[0]!.id;
  return rows[Math.max(0, Math.min(rows.length - 1, at + delta))]!.id;
}

/** The selection still valid after the list changed (an item was used up or given away). */
export function keepSelection(
  rows: readonly InvRow[],
  selectedId: string | undefined,
  lastIndex = 0,
): string | undefined {
  if (rows.length === 0) return undefined;
  if (rows.some((r) => r.id === selectedId)) return selectedId;
  return rows[Math.max(0, Math.min(rows.length - 1, lastIndex))]!.id;
}

export interface StatCompare {
  label: string;
  value: number;
  /** The equipped item's value, when there is one to compare with. */
  other?: number;
  /** value - other (positive is better for every stat shown). */
  delta?: number;
}

export interface Comparison {
  /** The equipped item of the same slot this is compared with. */
  against?: InvRow;
  stats: StatCompare[];
}

function statsOf(def: ItemDef | undefined, group: EquipGroup | undefined): { label: string; value: number }[] {
  if (!def) return [];
  if (group === 'armor') {
    return [
      { label: 'Defence (swing)', value: def.strengthSwing },
      { label: 'Defence (thrust)', value: def.strengthThrust },
    ];
  }
  return [
    { label: 'Damage (swing)', value: def.strengthSwing },
    { label: 'Damage (thrust)', value: def.strengthThrust },
    { label: 'Accuracy (swing)', value: def.accuracySwing },
    { label: 'Accuracy (thrust)', value: def.accuracyThrust },
  ];
}

/**
 * Stats of an equipment row; when another item of the same group is equipped in the same pack the
 * values are set against it. Rows without equipment stats give an empty list.
 */
export function compareWithEquipped(row: InvRow, packRows: readonly InvRow[], defs: readonly ItemDef[]): Comparison {
  const group = equipGroup(row.def);
  if (!group || row.source !== 'pack') return { stats: [] };
  const own = statsOf(row.def, group).filter((s) => s.value !== 0 || group === 'armor');
  const against = row.equipped
    ? undefined
    : packRows.find((r) => r.source === 'pack' && r.equipped && equipGroup(defs[r.item.itemIndex]) === group);
  const base = against ? statsOf(against.def, group) : [];
  const stats = own.map((s) => {
    const other = base.find((b) => b.label === s.label)?.value;
    return other === undefined ? s : { ...s, other, delta: s.value - other };
  });
  return { against, stats };
}

export type InvActionId = 'use' | 'equip' | 'repair' | 'give';

export interface InvAction {
  id: InvActionId;
  label: string;
  /** Character index of the recipient (give only). */
  target?: number;
  enabled: boolean;
  /** Why a disabled button is disabled (its tooltip). */
  reason?: string;
}

export const LOCKPICK_HELP =
  "Picklocks are not equipped: at a locked chest or door choose 'Pick the lock', and your best lockpicker uses one.";
export const KEY_HELP = 'Choose the key at a locked chest or door.';
export const KEY_RING_HELP = 'Kept on the party key ring, shared by everyone and not handed over or equipped.';

export interface ActionContext {
  /** The active party in order, with the owner of the pack among them. */
  party: readonly Character[];
  owner: Character | undefined;
  defs: readonly ItemDef[];
}

/** Whether anybody in the party carries a working tool (repairs need one). */
export function partyHasTool(party: readonly Character[], defs: readonly ItemDef[]): boolean {
  return party.some((c) => c.inventory.items.some((i) => defs[i.itemIndex]?.type === ItemType.Tool && !i.broken));
}

function canCarry(target: Character, row: InvRow): boolean {
  if (target.inventory.items.length < target.inventory.capacity) return true;
  return (row.def?.stackSize ?? 1) > 1 && target.inventory.items.some((i) => i.itemIndex === row.item.itemIndex);
}

const USABLE_TYPES: readonly number[] = [
  ItemType.Ration,
  ItemType.Food,
  ItemType.Potion,
  ItemType.Restoratives,
  ItemType.Scroll,
  ItemType.Book,
];

/** One line for the "how is this used" part of the details panel. */
export function usageHelp(row: InvRow): string | undefined {
  if (row.item.itemIndex === ITEM_PICKLOCK) return LOCKPICK_HELP;
  if (isKeyItem(row.item.itemIndex)) return KEY_HELP;
  return undefined;
}

/** The buttons for a row and whether each can be pressed. Disabled ones carry the reason. */
export function actionsFor(row: InvRow, ctx: ActionContext): InvAction[] {
  const def = row.def;
  const ownerIndex = ctx.owner?.index;
  if (row.source === 'ring') {
    return [{ id: 'use', label: 'Use', enabled: false, reason: usageHelp(row) ?? KEY_RING_HELP }];
  }
  const out: InvAction[] = [];

  // Use
  let use: Pick<InvAction, 'enabled' | 'reason'>;
  const help = usageHelp(row);
  if (help) use = { enabled: false, reason: help };
  else if (!def) use = { enabled: false, reason: 'Nothing is known about this item.' };
  else if (USABLE_TYPES.includes(def.type)) {
    use =
      def.type === ItemType.Book && row.item.conditionOrQuantity <= 0
        ? { enabled: false, reason: `${def.name} has no charges left.` }
        : { enabled: true };
  } else if (def.type === ItemType.Note) use = { enabled: false, reason: `${def.name} cannot be read yet.` };
  else if (equipGroup(def)) use = { enabled: false, reason: 'Equip it instead; weapons and armour are not used.' };
  else use = { enabled: false, reason: `${def.name} cannot be used.` };
  out.push({ id: 'use', label: 'Use', ...use });

  // Equip / unequip
  if (equipGroup(def)) {
    out.push({
      id: 'equip',
      label: row.equipped ? 'Unequip' : 'Equip',
      enabled: row.equipped || !row.broken,
      reason: !row.equipped && row.broken ? `${row.name} is broken: repair it first.` : undefined,
    });
  } else {
    out.push({ id: 'equip', label: 'Equip', enabled: false, reason: `${row.name} cannot be equipped.` });
  }

  // Repair: only offered for things with a condition
  if (hasCondition(def)) {
    let reason: string | undefined;
    if (!row.broken && row.item.conditionOrQuantity >= 100) reason = `${row.name} is in perfect condition.`;
    else if (row.broken && !row.item.repairable) reason = `${row.name} is beyond repair.`;
    else if (!partyHasTool(ctx.party, ctx.defs)) reason = 'Nobody in the party carries a tool to repair with.';
    out.push({ id: 'repair', label: 'Repair', enabled: reason === undefined, reason });
  }

  // Give to each other member
  for (const c of ctx.party) {
    if (c.index === ownerIndex) continue;
    const ok = canCarry(c, row);
    out.push({
      id: 'give',
      label: `Give to ${c.name}`,
      target: c.index,
      enabled: ok,
      reason: ok ? undefined : `${c.name} cannot carry any more.`,
    });
  }
  return out;
}

/** What double-click does: use consumables, equip equipment, otherwise nothing. */
export function defaultAction(actions: readonly InvAction[]): InvAction | undefined {
  const equip = actions.find((a) => a.id === 'equip' && a.enabled);
  if (equip) return equip;
  return actions.find((a) => a.id === 'use' && a.enabled);
}

const DESCRIPTIONS: Record<number, string> = {
  [ItemType.Sword]: 'A melee weapon. Equip it to fight with it.',
  [ItemType.Staff]: 'A staff, used in melee. Equip it to fight with it.',
  [ItemType.Crossbow]: 'A ranged weapon. Equip it to shoot in combat.',
  [ItemType.Armor]: 'Protective gear. Equip it to wear it.',
  [ItemType.Tool]: 'A tool. Carry it to repair weapons and armour.',
  [ItemType.Ration]: 'Eat it to cure hunger.',
  [ItemType.Food]: 'Eat it to cure hunger.',
  [ItemType.Potion]: 'Drink it to restore health.',
  [ItemType.Restoratives]: 'Restores health and cures poison and sickness.',
  [ItemType.Scroll]: 'A scroll. Use it to learn the spell it holds (magic-users only).',
  [ItemType.Book]: 'A book. Studying it can raise a skill; it loses a charge each time.',
  [ItemType.Note]: 'A written note.',
  [ItemType.WeaponOil]: 'An oil for weapons.',
  [ItemType.ArmorOil]: 'An oil for armour.',
  [ItemType.SpecialOil]: 'A special oil.',
  [ItemType.Bowstring]: 'Spare string for a bow or crossbow.',
  [ItemType.Light]: 'A source of light.',
  [ItemType.Ingredient]: 'A spell ingredient.',
};

/** Text for the details panel: what it is and how it is used. */
export function describeRow(row: InvRow): string[] {
  const help = usageHelp(row);
  if (help) return [help];
  const lines: string[] = [];
  const text = row.def && DESCRIPTIONS[row.def.type];
  if (text) lines.push(text);
  if (row.source === 'ring') lines.push(KEY_RING_HELP);
  return lines;
}

/** Condition and status notes: "Condition 87%", "Broken", "Poisoned", "Equipped". */
export function statusNotes(row: InvRow): string[] {
  const notes: string[] = [];
  if (row.def && hasCondition(row.def)) notes.push(`Condition ${row.item.conditionOrQuantity}%`);
  else if (row.def && row.def.stackSize > 1) notes.push(`Quantity ${row.item.conditionOrQuantity}`);
  if (row.equipped) notes.push('Equipped');
  if (row.broken) notes.push(row.item.repairable ? 'Broken (repairable)' : 'Broken');
  if (row.poisoned) notes.push('Poisoned');
  return notes;
}

/** "N sovereigns, M royals": the save counts royals, ten to the sovereign. */
export function formatMoney(royals: number): string {
  const s = Math.floor(royals / 10);
  const r = royals % 10;
  const parts: string[] = [];
  if (s > 0) parts.push(`${s} sovereign${s === 1 ? '' : 's'}`);
  if (r > 0 || parts.length === 0) parts.push(`${r} royal${r === 1 ? '' : 's'}`);
  return parts.join(', ');
}
