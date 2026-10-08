import { parseFixedObjects, parseSaveZoneContainers, type ContainerRecord } from '../formats/containers';
import { practiceCharacter } from './practice';
import type { ItemDef } from '../formats/objinfo';
import type { HudScreens } from '../ui/hud';
import type { ContainerView, WordLockView } from '../ui/containerScreen';
import '../ui/containerScreen'; // registers the container and word-lock screens
import {
  ContainerStore,
  bestLockpicker,
  disarmChance,
  isArmed,
  needsKey,
  needsWordLock,
  nearestContainer,
  openedFlagUpdate,
  putItem,
  springTrap,
  takeAll,
  takeItem,
  worldContainersFromRecords,
  type ContainerSnapshot,
  type WorldContainer,
} from './containers';
import { KEY_RULE, attemptLock, classifyLock, describeLock, isKeyItem, ITEM_PICKLOCK, keyItemForLock } from './locks';
import { removeItem, type PartyState } from './party';
import type { ResourceArchive } from '../formats/archive';
import { loadContainerData } from './containerData';
import { registerSaveExtra } from './saveExtras';
import type { WorldState } from './state';
import { isWordLockSolved, parseWordLock, startWordLock, turnTumbler, type WordLockState } from './wordLock';

/** What the container flow needs from the running game. */
export interface ContainerHost {
  items: readonly ItemDef[];
  store: ContainerStore;
  chapter: number;
  zone(): number;
  /** Party position in BaK units. */
  position(): { x: number; y: number };
  getParty(): PartyState;
  setParty(p: PartyState): void;
  getWorld(): WorldState;
  setWorld(w: WorldState): void;
  /** Text with choices (or none, for a plain message); resolves to the picked index, -1 when dismissed. */
  menu(text: string, choices: string[]): Promise<number>;
  /** The container screen; resolves when it is closed. The view's callbacks run while it is open. */
  showContainer(view: ContainerView): Promise<void>;
  /** The word-lock screen; resolves to whether the riddle was solved. */
  showWordLock(view: WordLockView, isSolved: () => boolean): Promise<boolean>;
  /** Riddle text for a word-lock chest (dialogue key 0x19f0a0 + index). */
  riddleText(fairyChestIndex: number): string | undefined;
  /** Play the dialogue a container shows when closed; resolves when it ends. */
  playDialog?(key: number): Promise<void>;
  /** Integer in [0, 100). */
  roll?(): number;
  /** Name of a model in the current zone's table, for the screen title. */
  modelName?(model: number): string | undefined;
}

const nameOf = (host: ContainerHost, itemIndex: number): string => host.items[itemIndex]?.name ?? `item ${itemIndex}`;
const defaultRoll = (): number => Math.floor(Math.random() * 100);

/** Screen title from the container's model name in the zone table (dbody1, rogebody, tstone3, ...). */
export function containerTitle(c: WorldContainer, modelName?: string): string {
  const name = modelName?.toLowerCase() ?? '';
  if (/body|bdy$/.test(name)) return 'Body';
  if (/^(tstone|tmbstone)/.test(name)) return 'Gravestone';
  if (/^bush/.test(name)) return 'Bush';
  return c.lock || name.startsWith('chest') ? 'Chest' : 'Container';
}

/** Work through whatever stands between the party and the contents; true when the container may be opened. */
async function getPast(host: ContainerHost, c: WorldContainer): Promise<WorldContainer | undefined> {
  const roll = host.roll ?? defaultRoll;
  let cur = c;
  const save = (next: WorldContainer) => {
    cur = next;
    host.store.replace(next);
  };

  if (needsWordLock(cur)) {
    const text = host.riddleText(cur.lock!.fairyChestIndex);
    const puzzle = text ? parseWordLock(text) : undefined;
    if (!puzzle) {
      console.warn(`word lock ${cur.lock!.fairyChestIndex}: riddle text missing or unreadable, opening the chest`);
      save({ ...cur, unlocked: true });
    } else {
      const pick = await host.menu('A riddle is cut into the lid. Turn the tumblers to spell the answer.', [
        'Try the riddle',
        'Leave it',
      ]);
      if (pick !== 0) return undefined;
      let state: WordLockState = startWordLock(puzzle);
      const view: WordLockView = {
        state: () => state,
        onTurn: (i) => (state = turnTumbler(state, i)),
        onLeave: () => {},
      };
      if (!(await host.showWordLock(view, () => isWordLockSolved(state)))) return undefined;
      await host.menu('The tumblers click and the lid springs open.', []);
      save({ ...cur, unlocked: true });
    }
  }

  while (needsKey(cur)) {
    const party = host.getParty();
    const rating = cur.lock!.rating;
    const best = bestLockpicker(party);
    const skill = best?.skill ?? 0;
    const looks = [
      'an easy lock for you',
      'too complicated to pick',
      'a lock that wants a special key',
      'a lock that is broken beyond repair',
    ][describeLock(skill, rating)];
    const hasKey =
      keyItemForLock(rating) !== undefined && party.partyKeys.items.some((i) => i.itemIndex === keyItemForLock(rating));
    const tools = party.partyKeys.items.filter((i) => i.itemIndex === ITEM_PICKLOCK || isKeyItem(i.itemIndex));
    const known = [...new Set(tools.map((i) => i.itemIndex))];
    const text = `The chest is locked: a ${classifyLock(rating)} lock, ${looks}.${hasKey ? ' You have a key that may fit.' : ''}`;
    const pick = await host.menu(text, [...known.map((i) => `Use ${nameOf(host, i)}`), 'Leave it']);
    const tool = known[pick];
    if (tool === undefined) return undefined;
    const r = attemptLock(tool, skill, rating, roll);
    if (r.consumed !== undefined) host.setParty(removeItem(host.getParty(), r.consumed, 1, KEY_RULE));
    if (r.learned && best) host.setParty(practiceCharacter(host.getParty(), best.character.index, 'lockpick'));
    if (r.unlocked) {
      save({ ...cur, unlocked: true });
      await host.menu(
        r.attempt.kind === 'opened' && r.attempt.with === 'key'
          ? 'The key turns and the lock opens.'
          : 'The lock gives way to the pick.',
        [],
      );
    } else {
      const why =
        r.attempt.kind === 'broke'
          ? `The ${nameOf(host, r.consumed!)} snaps in the lock.`
          : tool === ITEM_PICKLOCK
            ? 'The lock holds.'
            : 'The key does not fit.';
      await host.menu(why, []);
    }
  }

  if (isArmed(cur)) {
    const best = bestLockpicker(host.getParty());
    const chance = disarmChance(best?.skill ?? 0);
    const pick = await host.menu(
      `The chest is trapped! ${best ? `${best.character.name} could try to disarm it (${chance}%).` : ''}`,
      ['Try to disarm it', 'Open it anyway', 'Leave it'],
    );
    if (pick !== 0 && pick !== 1) return undefined;
    if (pick === 0 && best) host.setParty(practiceCharacter(host.getParty(), best.character.index, 'lockpick'));
    if (pick === 0 && roll() < chance) {
      await host.menu('The trap is disarmed.', []);
    } else {
      host.setParty(springTrap(host.getParty(), cur.lock!.trapDamage));
      await host.menu(`The trap goes off! Everyone takes ${cur.lock!.trapDamage} damage.`, []);
    }
    save({ ...cur, trapSpent: true });
  }
  return cur;
}

/** One use of the E key: find a container in reach, get past its lock and trap, then show its contents. Resolves true when something was there. */
export async function interact(host: ContainerHost): Promise<boolean> {
  const { x, y } = host.position();
  const found = nearestContainer(host.store.zone(host.zone()), x, y, host.chapter, host.getWorld());
  if (!found) return false;
  const opened = await getPast(host, found);
  if (!opened) return true;

  let cur = opened;
  let message = '';
  const view: ContainerView = {
    title: containerTitle(cur, host.modelName?.(cur.model)),
    capacity: () => cur.capacity,
    items: () => cur.items,
    message: () => message,
    onTake: (slot) => {
      const r = takeItem(host.getParty(), cur, slot, host.items);
      message = r.moved ? '' : 'Nobody can carry that.';
      if (r.moved) {
        host.setParty(r.party);
        cur = r.container;
        host.store.replace(cur);
      }
    },
    onTakeAll: () => {
      const r = takeAll(host.getParty(), cur, host.items);
      message = r.left > 0 ? 'Some things were left behind.' : '';
      if (r.moved) {
        host.setParty(r.party);
        cur = r.container;
        host.store.replace(cur);
      }
    },
    onPut: (tab, slot) => {
      const party = host.getParty();
      const index = party.activeCharacters[tab];
      const r = index === undefined ? undefined : putItem(party, index, slot, cur, host.items);
      if (r?.ok) {
        host.setParty(r.party);
        cur = r.container;
        host.store.replace(cur);
        message = '';
      } else {
        message = r?.reason === 'equipped' ? 'Unequip it first.' : r?.reason === 'full' ? 'No room in there.' : '';
      }
    },
    onClose: () => {},
  };
  host.setWorld(openedFlagUpdate(cur, host.getWorld()));
  await host.showContainer(view);
  if (cur.dialogKey !== undefined && host.playDialog) await host.playDialog(cur.dialogKey);
  return true;
}

/** Build the container source: the save image's live blocks first, `OBJFIXED.DAT` for zones the save has none for. */
export function containerSource(
  save: Uint8Array | undefined,
  fixed: Uint8Array | undefined,
): (zone: number) => WorldContainer[] {
  let fixedRecords: ContainerRecord[] | undefined;
  return (zone) => {
    const fromSave = save ? parseSaveZoneContainers(save, zone) : [];
    if (fromSave.length > 0) return worldContainersFromRecords(zone, fromSave);
    if (fixed && !fixedRecords) fixedRecords = parseFixedObjects(fixed);
    const zoneRecords = (fixedRecords ?? []).filter((r) => r.location.kind === 'world' && r.location.zone === zone);
    return worldContainersFromRecords(zone, zoneRecords);
  };
}

export interface ContainerSetup {
  items: readonly ItemDef[];
  chapter: number;
  /** The loaded save image (live container blocks). */
  saveBytes?: Uint8Array;
  /** Where `OBJFIXED.DAT` and the riddle texts are read from. */
  archive: ResourceArchive;
  hud: Pick<HudScreens, 'open' | 'screenHandler' | 'setParty' | 'blocking' | 'close' | 'showDialog'>;
  zone(): number;
  position(): { x: number; y: number };
  getParty(): PartyState;
  setParty(p: PartyState): void;
  getWorld(): WorldState;
  setWorld(w: WorldState): void;
  /** False while a dialogue, town scene, fight or zone change owns the game. */
  canInteract(): boolean;
  playDialog?(key: number): Promise<void>;
  modelName?(model: number): string | undefined;
}

/** E opens the container the party stands next to. The only wiring main.ts needs: one call with the setup. */
export async function installContainers(setup: ContainerSetup): Promise<ContainerStore> {
  const data = await loadContainerData(setup.archive);
  const store = new ContainerStore(containerSource(setup.saveBytes, data.fixedObjects));
  registerSaveExtra('containers', {
    capture: () => store.snapshot(),
    restore: (data) => store.restore(data as ContainerSnapshot | undefined),
  });
  const hud = setup.hud;
  const host: ContainerHost = {
    ...setup,
    // Read live: `setup.chapter` may be a getter that follows chapter transitions.
    get chapter() {
      return setup.chapter;
    },
    store,
    riddleText: data.riddleText,
    menu: (text, choices) =>
      new Promise((resolve) =>
        hud.showDialog({ text, displayStyle3: 0 }, choices, (r) => resolve(r.kind === 'choose' ? r.index : -1)),
      ),
    showContainer: (view) =>
      new Promise((resolve) => {
        const screen = hud.screenHandler<import('../ui/containerScreen').ContainerScreen>('container');
        screen.show({
          ...view,
          onClose: () => {
            view.onClose();
            resolve();
          },
        });
        hud.open('container');
      }),
    showWordLock: (view, isSolved) =>
      new Promise((resolve) => {
        const screen = hud.screenHandler<import('../ui/containerScreen').WordLockScreen>('wordlock');
        const leave = () => resolve(false);
        screen.show({
          ...view,
          onTurn: (i) => {
            view.onTurn(i);
            if (isSolved()) {
              resolve(true); // before closing: the close also reports a leave, which must not win
              hud.close();
            }
          },
          onLeave: leave,
        });
        hud.open('wordlock');
      }),
  };
  let busy = false;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE' || e.repeat || busy || !setup.canInteract()) return;
    busy = true;
    interact(host)
      .catch((err) => console.error('container:', err))
      .finally(() => {
        busy = false;
      });
  });
  return store;
}
