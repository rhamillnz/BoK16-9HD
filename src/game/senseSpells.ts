import type { ContainerItem } from '../formats/containers';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { visibleIn, type WorldContainer } from './containers';
import type { WorldState } from './state';

/**
 * The sensing spells cast outside combat (SPELLDOC): Eyes of Ishap "Caster can sense vessels", The Unseen "Caster
 * can sense food", Nacre Cicatrix "Caster can sense magic items". How the original shows what was sensed is not
 * known; the remake names how many containers nearby hold such things and which way the nearest lies.
 */

const MAGIC_TYPES: ReadonlySet<number> = new Set([
  ItemType.Staff,
  ItemType.Scroll,
  ItemType.Potion,
  ItemType.SpecialOil,
]);

export const SENSE_SPELLS: Record<number, { what: string; holds: (item: ContainerItem, def?: ItemDef) => boolean }> = {
  // A vessel: any container with something in it.
  11: { what: 'filled vessels', holds: () => true },
  17: { what: 'food', holds: (_, d) => d?.type === ItemType.Ration || d?.type === ItemType.Food },
  18: {
    what: 'magic',
    holds: (i, d) => (d !== undefined && (MAGIC_TYPES.has(d.type) || (d.effectMask ?? 0) !== 0)) || i.modifiers !== 0,
  },
};

/** How far the senses reach, in BaK units: twenty map cells. */
export const SENSE_RADIUS = 32000;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Compass direction from (x, y) to (tx, ty), BaK axes (y north). */
export function compassTo(x: number, y: number, tx: number, ty: number): string {
  const angle = Math.atan2(tx - x, ty - y); // 0 = north, clockwise
  const sector = Math.round((angle / (Math.PI * 2)) * 8);
  return COMPASS[((sector % 8) + 8) % 8]!;
}

/** What `spell` senses among `containers` around (x, y): a sentence for the cast message. */
export function senseNearby(
  spell: number,
  containers: readonly WorldContainer[],
  x: number,
  y: number,
  chapter: number,
  world: WorldState,
  defs: readonly ItemDef[],
): string {
  const sense = SENSE_SPELLS[spell];
  if (!sense) return 'Nothing stirs.';
  const found = containers
    .filter((c) => visibleIn(c, chapter, world) && (c.x - x) ** 2 + (c.y - y) ** 2 <= SENSE_RADIUS ** 2)
    .filter((c) => c.items.some((i) => sense.holds(i, defs[i.itemIndex])))
    .sort((a, b) => (a.x - x) ** 2 + (a.y - y) ** 2 - ((b.x - x) ** 2 + (b.y - y) ** 2));
  const nearest = found[0];
  if (!nearest) return `No ${sense.what} can be sensed nearby.`;
  const where =
    Math.hypot(nearest.x - x, nearest.y - y) < 1600 ? 'right here' : `to the ${compassTo(x, y, nearest.x, nearest.y)}`;
  const places = found.length === 1 ? 'one place' : `${found.length} places`;
  const what = sense.what[0]!.toUpperCase() + sense.what.slice(1);
  return `${what} can be sensed in ${places} nearby; the nearest lies ${where}.`;
}
