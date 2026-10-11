import { activeCharacters, type PartyState } from './party';
import { bestLockpicker } from './containers';
import { ITEM_PICKLOCK, canPickLock, classifyLock, isKeyItem, keyItemForLock, picklockBreakChance } from './locks';

/** One thing the party can do at a locked chest or door. */
export interface LockChoice {
  label: string;
  /** Item used: a key, or ITEM_PICKLOCK. */
  tool: number;
}

/** Picklocks the party carries: they are a stack in a character's pack (and, from older saves, on the key ring). */
export function picklockCount(p: PartyState): number {
  let n = p.partyKeys.items.filter((i) => i.itemIndex === ITEM_PICKLOCK).length;
  for (const c of activeCharacters(p))
    for (const i of c.inventory.items) if (i.itemIndex === ITEM_PICKLOCK) n += Math.max(1, i.conditionOrQuantity);
  return n;
}

/**
 * What the lock screen says and offers. Only a key that fits is offered (trying the wrong one only risked
 * snapping it); picking is offered with picklocks in anyone's pack, done by the best lockpicker, with the odds
 * spelt out.
 */
export function lockMenu(
  p: PartyState,
  rating: number,
  nameOf: (itemIndex: number) => string,
): { text: string; choices: LockChoice[] } {
  const kind = { easy: 'an easy', medium: 'a medium', hard: 'a hard', unpickable: 'a special' }[classifyLock(rating)];
  const lines = [`The chest is locked (${kind} lock).`];
  const choices: LockChoice[] = [];
  const keyItem = keyItemForLock(rating);
  const keys = p.partyKeys.items.filter((i) => isKeyItem(i.itemIndex));
  if (keyItem !== undefined && keys.some((i) => i.itemIndex === keyItem)) {
    lines.push(`Your ${nameOf(keyItem)} fits it.`);
    choices.push({ label: `Use the ${nameOf(keyItem)}`, tool: keyItem });
  } else if (keys.length) {
    lines.push(keys.length === 1 ? `Your ${nameOf(keys[0]!.itemIndex)} does not fit it.` : 'None of your keys fit it.');
  }

  if (rating > 100) {
    lines.push(
      keyItem !== undefined
        ? `It cannot be picked: it needs the ${nameOf(keyItem)}.`
        : 'It cannot be picked or opened.',
    );
  } else {
    const best = bestLockpicker(p);
    const picks = picklockCount(p);
    const who = best?.character.name ?? 'Nobody';
    const skill = best?.skill ?? 0;
    if (canPickLock(skill, rating)) {
      if (picks)
        choices.push({
          label: `Pick the lock (${who}, ${picks} picklock${picks > 1 ? 's' : ''})`,
          tool: ITEM_PICKLOCK,
        });
      else lines.push(`${who} could pick it, but you have no picklocks.`);
    } else {
      const snap = picklockBreakChance(skill, rating);
      lines.push(`It is too hard for ${who} to pick (Lockpick ${skill}; it needs more than ${rating}).`);
      if (picks) choices.push({ label: `Try anyway (${snap}% a picklock snaps)`, tool: ITEM_PICKLOCK });
      else lines.push('You have no picklocks.');
    }
  }
  choices.push({ label: 'Leave it', tool: -1 });
  return { text: lines.join(' '), choices };
}
