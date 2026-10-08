/**
 * Who speaks a dialogue snippet. The snippet's `actor` is either a special code that points at a
 * party member or a dialogue character, or an actor number: 1-6 are the party (character index + 1),
 * anything else is a named NPC whose name is KEYWORD.DAT string `actor + 293`.
 */

export interface Speaker {
  /** Actor number: 1-6 are Locklear, Gorath, Owyn, Pug, James and Patrus; others are NPCs (portrait ACTnnn). */
  actor: number;
  name: string;
}

export const ACTOR_NONE = 0;
/** Actor code for "nobody". */
export const ACTOR_NOBODY = 0xc8;
/** Actor 0xff: the character the dialogue picked, else the first active party member. */
export const ACTOR_DIALOG_OR_FIRST = 0xff;
export const ACTOR_LEADER = 0xfe;
/** 0xfd is dialogue character list entry 5; 0xf0-0xfc are entries 0-12. */
export const ACTOR_DIALOG_LIST_5 = 0xfd;
export const ACTOR_DIALOG_LIST_BASE = 0xf0;
/** KEYWORD.DAT string number of actor n's name is n + this. */
export const ACTOR_NAME_OFFSET = 293;

const PARTY_NAMES = ['Locklear', 'Gorath', 'Owyn', 'Pug', 'James', 'Patrus'];

export interface SpeakerContext {
  /** KEYWORD.DAT strings. */
  keywords: readonly string[];
  /** Character index (0-5) per dialogue character list entry; 0xff or absent means unset. */
  dialogCharacters?: readonly number[];
  /** Character index of the party leader. */
  leader?: number;
  /** Character index of the first active party member. */
  firstActive?: number;
  /** The save's name for a character index, when known. */
  characterName?: (index: number) => string | undefined;
}

/** Resolve a snippet's `actor` to a speaker, or undefined when nobody speaks or the name is unknown. */
export function resolveSpeaker(rawActor: number, ctx: SpeakerContext): Speaker | undefined {
  if (rawActor === ACTOR_NONE || rawActor === ACTOR_NOBODY) return undefined;
  const fromCharacter = (index: number | undefined): Speaker | undefined => {
    if (index === undefined || index < 0 || index >= PARTY_NAMES.length) return undefined;
    return { actor: index + 1, name: ctx.characterName?.(index) ?? PARTY_NAMES[index]! };
  };
  const listed = (entry: number): number | undefined => {
    const c = ctx.dialogCharacters?.[entry];
    return c === undefined || c === 0xff ? undefined : c;
  };

  if (rawActor === ACTOR_DIALOG_OR_FIRST) return fromCharacter(ctx.firstActive);
  if (rawActor === ACTOR_LEADER) return fromCharacter(ctx.leader);
  if (rawActor === ACTOR_DIALOG_LIST_5) return fromCharacter(listed(5));
  if (rawActor >= ACTOR_DIALOG_LIST_BASE && rawActor < ACTOR_DIALOG_LIST_5)
    return fromCharacter(listed(rawActor - ACTOR_DIALOG_LIST_BASE));
  if (rawActor >= 1 && rawActor <= PARTY_NAMES.length) return fromCharacter(rawActor - 1);
  const name = ctx.keywords[rawActor + ACTOR_NAME_OFFSET];
  return name ? { actor: rawActor, name } : undefined;
}
