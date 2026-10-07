import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import { HotspotAction, type Hotspot } from '../formats/gds';
import type { GdsContainer, ShopStats } from '../formats/gdsShops';
import { ItemType, type ItemDef } from '../formats/objinfo';
import type { ReqLayout } from '../formats/req';
import type { MenuModel } from '../ui/menuScreen';
import type { PartyState } from './party';
import type { WorldState } from './state';
import { TEMPLE_CHOICE, TEMPLE_DIALOG, markTempleSeen, templeSeen } from './temple';
import { ailments, formatRoyals, installTemples, type TempleDeps } from './templeFlow';
import type { TownScene } from './townScene';
import { TownController, type DialogEnd } from './townController';

const skill = (max: number, trueSkill: number): Skill => ({ max, trueSkill, current: 0, experience: 0, modifier: 0, selected: false, unseenImprovement: false });
function character(index: number, cond: Partial<Character['conditions']> = {}, items: Character['inventory']['items'] = []): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(50, 10);
  skills.stamina = skill(40, 5);
  return {
    index, name: `C${index}`, unknownHeader: new Uint8Array(2), spellBytes: new Uint8Array(6), spells: [], skills,
    combatCharIndex: 0, unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 0, ...cond },
    affectors: [], inventory: { capacity: 8, items },
  };
}
const sword = { itemIndex: 1, conditionOrQuantity: 100, status: 0, modifiers: 0, activated: false, used: false, broken: false, repairable: false, equipped: false, poisoned: false };
const items = [] as ItemDef[];
items[1] = { index: 1, name: 'Sword', type: ItemType.Sword, value: 100 } as ItemDef;

const shop: ShopStats = {
  templeNumber: 1, sellFactor: 3, maxDiscount: 20, buyFactor: 3, haggleDifficulty: 65, haggleAnnoyance: 2, bardingSkill: 0, bardingReward: 0,
  bardingMaxReward: 0, unknown: 0, innSleepTilHour: 0, innCost: 0, repairTypes: 0, repairFactor: 0, categories: 5,
};
const container = (number: number): GdsContainer => ({ index: 0, ref: { number, letter: 'A' }, flags: 4, shop, address: 0 });

const hotspot = (action: number, arg3 = 0x1000): Hotspot => ({ index: 0, x: 0, y: 0, width: 1, height: 1, chapterMask: 0, keyword: 0, action, unknownD: 0, arg1: 0, arg2: 0, arg3, tooltip: 0, dialog: 0, checkEventState: 0 }) as unknown as Hotspot;
const sceneOf = (number: number, templeIndex: number, hotspots: Hotspot[]): TownScene =>
  ({ ref: { number, letter: 'A' }, gds: { templeIndex, hotspots }, image: { width: 1, height: 1, rgba: new Uint8ClampedArray(4) } }) as unknown as TownScene;

interface Harness {
  town: TownController;
  menus: MenuModel[];
  pick(id: string): void;
  cancel(): void;
  dialogs: number[];
  state: { party: PartyState; world: WorldState; travelled: number[] };
  script: (DialogEnd | undefined)[];
}

function harness(scene: TownScene, party: PartyState, layout?: ReqLayout): Harness {
  const state = { party, world: { chapter: 1, ticks: 0, ticksLastSlept: 0, bytes: new Uint8Array(0x4000), expiringEvents: [] } as WorldState, travelled: [] as number[] };
  const menus: MenuModel[] = [];
  const dialogs: number[] = [];
  const script: (DialogEnd | undefined)[] = [];
  let onPick: (id: string) => void = () => {};
  let onCancel: () => void = () => {};
  const town = new TownController({
    load: async () => scene, show: () => {}, hide: () => {}, playDialog: () => {}, activeHotspots: (s) => s.gds.hotspots, left: () => {},
  });
  const deps: TempleDeps = {
    menu: { show: (m, p, c) => { menus.push(m); onPick = p; onCancel = c; }, close: () => {} },
    playDialog: (key, done) => { dialogs.push(key); done(script.shift() ?? { cancelled: false, endState: 0 }); },
    getParty: () => state.party, setParty: (p) => { state.party = p; },
    getWorld: () => state.world, setWorld: (w) => { state.world = w; },
    items, containers: () => [container(scene.ref.number)], teleportLayout: layout, travel: (i) => state.travelled.push(i),
  };
  installTemples(town, deps);
  return { town, menus, pick: (id) => onPick(id), cancel: () => onCancel(), dialogs, state, script };
}

const poorParty = (): PartyState => ({
  gold: 1000, characters: [character(0, { sick: 20 }, [{ ...sword }]), character(1)], activeCharacters: [0, 1], partyKeys: { capacity: 4, items: [] },
});

describe('temple hotspot', () => {
  const temple = hotspot(HotspotAction.Temple);
  const scene = sceneOf(5, 0x81, [temple]);

  it('cures a character through the menu and returns to the temple dialogue', async () => {
    const h = harness(scene, poorParty());
    await h.town.enter(scene.ref);
    h.script.push({ cancelled: false, endState: 0, choice: TEMPLE_CHOICE.cure });
    h.town.click(temple);
    const menu = h.menus.at(-1)!;
    expect(menu.title).toBe('Temple healing');
    expect(menu.lines.join('\n')).toContain('Sick 20');
    // sick 20 -> 90 * 65% = 58
    expect(menu.lines.join('\n')).toContain('5 sovereigns 8 royals');
    h.script.push(undefined); // post-healing dialogue
    h.script.push({ cancelled: false, endState: 0, choice: TEMPLE_CHOICE.done });
    h.pick('cure');
    expect(h.state.party.gold).toBe(1000 - 58);
    expect(h.state.party.characters[0]!.conditions).toMatchObject({ sick: 0, healing: 20 });
    expect(h.dialogs).toContain(TEMPLE_DIALOG.healPostHealing);
    // Done chosen: the scene works again.
    h.script.push({ cancelled: false, endState: 0, choice: TEMPLE_CHOICE.done });
    h.town.click(temple);
    expect(h.dialogs.filter((k) => k === 0x1000).length).toBeGreaterThanOrEqual(3);
  });

  it('says so when nobody needs curing', async () => {
    const healthy: PartyState = { ...poorParty(), characters: [character(0), character(1)] };
    const h = harness(scene, healthy);
    await h.town.enter(scene.ref);
    h.script.push({ cancelled: false, endState: 0, choice: TEMPLE_CHOICE.cure });
    h.script.push(undefined);
    h.script.push({ cancelled: false, endState: 0, choice: TEMPLE_CHOICE.done });
    h.town.click(temple);
    expect(h.menus).toHaveLength(0);
    expect(h.dialogs).toContain(TEMPLE_DIALOG.healCantHealNotSickEnough);
  });

  it('refuses a cure the poor party cannot afford', async () => {
    const h = harness(scene, { ...poorParty(), gold: 10 });
    await h.town.enter(scene.ref);
    h.script.push({ cancelled: false, endState: 0, choice: TEMPLE_CHOICE.cure });
    h.town.click(temple);
    h.pick('cure');
    expect(h.menus.at(-1)!.message).toMatch(/afford/);
    expect(h.state.party.gold).toBe(10);
  });

  it('blesses a weapon from the list', async () => {
    const h = harness(scene, poorParty());
    await h.town.enter(scene.ref);
    h.script.push({ cancelled: false, endState: 0, choice: TEMPLE_CHOICE.bless });
    h.town.click(temple);
    const menu = h.menus.at(-1)!;
    expect(menu.rows.map((r) => r.label)).toEqual(['C0: Sword']);
    h.pick('0:0');
    expect(h.state.party.gold).toBe(950);
    expect(h.state.party.characters[0]!.inventory.items[0]!.modifiers).toBe(0x80);
    expect(h.menus.at(-1)!.rows[0]!.label).toContain('(blessed)');
  });

  it('ignores a service the dialogue refused (end state -1) and Cancel leaves the scene usable', async () => {
    const h = harness(scene, poorParty());
    await h.town.enter(scene.ref);
    h.script.push({ cancelled: false, endState: -1, choice: TEMPLE_CHOICE.cure });
    h.script.push({ cancelled: true, endState: undefined });
    h.town.click(temple);
    expect(h.menus).toHaveLength(0);
  });
});

describe('teleport hotspot', () => {
  const tele = hotspot(HotspotAction.Teleport, 0);
  const scene = sceneOf(5, 0x83, [tele]);
  const layout = {
    widgets: [1, 2, 3].map((n) => ({ x: n * 40, y: n * 10, width: 8, height: 8, label: `#Temple ${n}` })),
  } as unknown as ReqLayout;

  it('marks the temple seen when its scene opens', async () => {
    const h = harness(scene, poorParty(), layout);
    await h.town.enter(scene.ref);
    expect(templeSeen(h.state.world, 3)).toBe(true);
  });

  it('lists seen temples with costs, charges and travels', async () => {
    const h = harness(scene, poorParty(), layout);
    h.state.world = markTempleSeen(h.state.world, 1);
    await h.town.enter(scene.ref); // marks 3
    h.town.click(tele);
    const menu = h.menus.at(-1)!;
    expect(menu.title).toBe('Teleport');
    expect(menu.rows.map((r) => r.label)).toEqual(['Temple 1']);
    // from temple 3 (120,30) to temple 1 (40,10): 80 + 20*3/8=7 -> 87; (87*2+5)*10 = 1790; (1790+5)/10 = 179
    expect(menu.rows[0]!.detail).toBe('17 sovereigns 9 royals');
    h.pick('1');
    expect(h.state.party.gold).toBe(1000 - 179);
    expect(h.state.travelled).toEqual([0]);
    expect(h.dialogs).toContain(TEMPLE_DIALOG.teleportPost);
  });

  it('has no destinations until a second temple is known', async () => {
    const h = harness(scene, poorParty(), layout);
    await h.town.enter(scene.ref);
    h.town.click(tele);
    expect(h.menus).toHaveLength(0);
    expect(h.dialogs).toContain(TEMPLE_DIALOG.teleportNoDestinations);
  });

  it('is blocked at the Chapel of Ishap in chapter 6', async () => {
    const chapel = sceneOf(9, 0x8c, [hotspot(HotspotAction.Teleport, 0)]);
    const h = harness(chapel, poorParty(), layout);
    h.state.world = { ...h.state.world, chapter: 6 };
    await h.town.enter(chapel.ref);
    h.town.click(chapel.gds.hotspots[0]!);
    expect(h.dialogs).toEqual([TEMPLE_DIALOG.teleportBlockedSource]);
  });
});

describe('formatting', () => {
  it('writes money in sovereigns and royals', () => {
    expect(formatRoyals(0)).toBe('0 royals');
    expect(formatRoyals(1)).toBe('1 royal');
    expect(formatRoyals(10)).toBe('1 sovereign');
    expect(formatRoyals(34)).toBe('3 sovereigns 4 royals');
  });

  it('lists ailments but not Healing', () => {
    expect(ailments(character(0))).toBe('No ailments');
    expect(ailments(character(0, { sick: 5, healing: 90, nearDeath: 2 }))).toBe('Sick 5, Near death 2');
  });
});
