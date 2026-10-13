import type { ContainerItem } from '../formats/containers';
import type { Fighter } from './battle';

/** What the slain enemies of a fight carried: their combat inventories (by combat and enemy-list slot). */
export function lootOf(
  inventories: ReadonlyMap<string, readonly ContainerItem[]>,
  combatIndex: number,
  fighters: readonly Fighter[],
): ContainerItem[] {
  const out: ContainerItem[] = [];
  for (const f of fighters) {
    if (f.side !== 'enemy' || f.health > 0 || f.slot === undefined) continue;
    for (const i of inventories.get(`${combatIndex}:${f.slot}`) ?? []) out.push({ ...i });
  }
  return out;
}
