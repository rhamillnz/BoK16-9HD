import { playSfx } from '../audio/sfxBus';
import { ActionType, type DialogAction } from '../formats/ddx';
import { applyDialogEffects, type DialogEffectsContext } from './dialogEffects';
import { QUERY_NO, type DialogSession } from './encounterRunner';
import type { PartyState } from './party';
import type { Destination, ZoneTransition } from './transitions';

export interface DialogOutcome {
  world: DialogEffectsContext['world'];
  party: PartyState;
  ticksElapsed: number;
  /** Where the party goes next, if the dialogue or the zone encounter sends it somewhere. */
  destination: Destination | undefined;
  lostItems: { itemIndex: number; quantity: number }[];
  improvedSkills: number[];
  unhandled: DialogAction[];
  warnings: string[];
}

export interface DialogOutcomeOptions extends Omit<DialogEffectsContext, 'world' | 'party'> {
  session: DialogSession;
  /** The party's state before the dialogue; the session holds the world it left behind. */
  party: PartyState;
  /** World state to apply to; defaults to the session's. Use it to carry the clock's time into the session's flags. */
  world?: DialogEffectsContext['world'];
  /** TELEPORT.DAT destinations by teleport index. */
  teleports?: readonly Destination[];
  /** Set for a zone encounter that had a dialogue. */
  transition?: ZoneTransition;
  cancelled?: boolean;
}

/**
 * Everything that follows a finished dialogue: its pending actions are applied to the world and
 * the party, then the destination is chosen. A Teleport action wins; otherwise a zone encounter
 * takes its transition, unless the dialogue was cancelled or the player answered "No" to it.
 */
export function resolveDialogOutcome(o: DialogOutcomeOptions): DialogOutcome {
  const { session } = o;
  const effects = applyDialogEffects(
    {
      ...o,
      world: o.world ?? session.world,
      party: o.party,
      dialogCharacters: o.dialogCharacters ?? session.dialogCharacters,
    },
    session.pendingActions,
  );
  const warnings = [...session.warnings];
  for (const a of session.pendingActions) if (a.type === ActionType.PlaySound) playSfx(a.words[0]);

  let destination: Destination | undefined;
  if (session.teleport !== undefined) {
    destination = o.teleports?.[session.teleport];
    if (!destination) warnings.push(`teleport ${session.teleport} is not in TELEPORT.DAT`);
  } else if (o.transition && !o.cancelled && session.lastChoice !== QUERY_NO) {
    destination = o.transition;
  }
  return {
    world: effects.world,
    party: effects.party,
    ticksElapsed: effects.ticksElapsed,
    destination,
    lostItems: effects.lostItems,
    improvedSkills: effects.improvedSkills,
    unhandled: effects.unhandled.filter((a) => a.type !== ActionType.PlaySound),
    warnings,
  };
}
