import { describe, expect, it } from 'vitest';
import { ItemType, type ItemDef } from '../src/formats/objinfo';
import type { WorldContainer } from '../src/game/containers';
import { compassTo, senseNearby } from '../src/game/senseSpells';
import type { WorldState } from '../src/game/state';

const defs = [{ type: ItemType.Sword }, { type: ItemType.Ration }, { type: ItemType.Potion }] as unknown as ItemDef[];
const box = (id: string, x: number, y: number, itemIndex: number): WorldContainer => ({
  id,
  zone: 1,
  x,
  y,
  model: 0,
  fromChapter: 1,
  toChapter: 9,
  capacity: 5,
  items: [{ itemIndex, conditionOrQuantity: 1, status: 0, modifiers: 0 }],
  unlocked: false,
  trapSpent: false,
});
const world = {} as WorldState;

describe('sensing spells', () => {
  const boxes = [box('a', 0, 5000, 1), box('b', 8000, 0, 1), box('c', 100, 100, 2), box('far', 0, 90000, 1)];
  it('finds food nearby and points at the nearest', () => {
    expect(senseNearby(17, boxes, 0, 0, 1, world, defs)).toBe(
      'Food can be sensed in 2 places nearby; the nearest lies to the north.',
    );
  });
  it('finds magic and says when it is right here', () => {
    expect(senseNearby(18, boxes, 0, 0, 1, world, defs)).toContain('one place nearby; the nearest lies right here');
  });
  it('says when nothing is near', () => {
    expect(senseNearby(17, [], 0, 0, 1, world, defs)).toBe('No food can be sensed nearby.');
  });
  it('names compass directions with y north', () => {
    expect(compassTo(0, 0, 10, 0)).toBe('east');
    expect(compassTo(0, 0, -10, -10)).toBe('south-west');
  });
});
