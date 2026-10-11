import type { CombatOutcome } from '../combat/turns';
import { ITEM_PICKLOCK } from './locks';
import { registerSaveExtra } from './saveExtras';

/**
 * Fights the remake adds at chests (not in the original): the first time the party goes for the chest, the
 * monsters of a DEF_COMB entry attack. Won once, an ambush is gone for good (and may leave loot); lost, it waits
 * for the next try.
 */
export interface ChestAmbush {
  /** DEF_COMB.DAT entry whose monsters attack. */
  combat: number;
  /** Shown before the fight. */
  text: string;
  /** Found on the fallen after a win. */
  loot?: { item: number; quantity: number; text: string };
}

/** By container id (`zone:index`). */
export const CHEST_AMBUSHES: Readonly<Record<string, ChestAmbush>> = {
  // The chest off the road south of the start (an easy lock): two moredhel warriors (DEF_COMB 1) were watching it.
  '1:24': {
    combat: 1,
    text: 'As you kneel by the chest, two dark shapes step out from the trees. Moredhel! They had been watching it, and whoever came for it.',
    // Picklocks: the party starts without any, and this chest's lock wants picking.
    loot: { item: ITEM_PICKLOCK, quantity: 4, text: 'One of the moredhel carried a set of picklocks.' },
  },
};

export interface AmbushDeps {
  menu(text: string, choices: string[]): Promise<number>;
  fight(combat: number): Promise<CombatOutcome | undefined>;
  /** Hand `quantity` of an item to the party; false when nobody has room. */
  give(item: number, quantity: number): boolean;
}

/** The chest hook for `installContainers`: resolves false when the party lost and the chest stays shut. */
export function installChestAmbushes(
  deps: AmbushDeps,
  table: Readonly<Record<string, ChestAmbush>> = CHEST_AMBUSHES,
): (containerId: string) => Promise<boolean> {
  let won = new Set<string>();
  registerSaveExtra('ambushes', {
    capture: () => [...won],
    restore: (data) => {
      won = new Set(Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : []);
    },
  });
  return async (id) => {
    const ambush = table[id];
    if (!ambush || won.has(id)) return true;
    await deps.menu(ambush.text, ['Fight!']);
    const outcome = await deps.fight(ambush.combat);
    if (outcome === undefined) return true; // combat unavailable: don't lock the player out of the chest
    if (outcome !== 'won') return false;
    won.add(id);
    if (ambush.loot) {
      const kept = deps.give(ambush.loot.item, ambush.loot.quantity);
      await deps.menu(kept ? ambush.loot.text : `${ambush.loot.text} Nobody has room to carry them.`, []);
    }
    return true;
  };
}
