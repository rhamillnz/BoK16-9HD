import { SKILL_NAMES } from '../formats/gam';
import type { SpeakerContext } from './speaker';
import { ROYALS_PER_SOVEREIGN, type PartyState } from './party';

/**
 * Dialogue text variables. Snippet text holds `@N` (a single digit) placeholders that the
 * dialogue's SetTextVariable actions fill in, and a bare `@` that stands for the active character.
 * Semantics follow docs/formats/dialogue.md section 6.1.
 */

/** Character indices as the original numbers them. */
export const CHAR_LOCKLEAR = 0;
export const CHAR_GORATH = 1;
export const CHAR_OWYN = 2;
export const CHAR_PUG = 3;
export const CHAR_JAMES = 4;
export const CHAR_PATRUS = 5;

/** Party leader per chapter (1-9); Pug leads whenever he is in the party. */
const LEADER_PER_CHAPTER = [
  CHAR_LOCKLEAR,
  CHAR_JAMES,
  CHAR_JAMES,
  CHAR_GORATH,
  CHAR_JAMES,
  CHAR_OWYN,
  CHAR_JAMES,
  CHAR_OWYN,
  CHAR_PUG,
];

/** What the variables can be filled from. Everything but `party` is optional. */
export interface TextVariableContext {
  party: Pick<PartyState, 'gold' | 'characters' | 'activeCharacters'>;
  /** Current chapter (1-9); picks the party leader. Default 1. */
  chapter?: number;
  /** Character the dialogue concerns (the "active character"); defaults to the leader. */
  activeCharacter?: number;
  /** Character picked by the last skill check. */
  skillCheckedCharacter?: number;
  monsterName?: string;
  /** Name of the item the player picked, and the price of the item being bought or sold, in royals. */
  itemName?: string;
  itemValue?: number;
  /** Skill that just improved (an index into SKILL_NAMES). */
  improvedSkill?: number;
  /** Name of the shop or inn keeper's role; default "shopkeeper". */
  keeperName?: string;
  /** Uniform integer in [0, n). Defaults to Math.random. */
  random?: (n: number) => number;
}

/** "3 sovereigns and 2 royals". Numbers and unit words carry the emphasis code 0xF0, like the original's. */
export function moneyString(royals: number): string {
  const total = Math.max(0, Math.floor(royals));
  const sovereigns = Math.floor(total / ROYALS_PER_SOVEREIGN);
  const rest = total % ROYALS_PER_SOVEREIGN;
  let s = '';
  if (sovereigns !== 0) s += `ð${sovereigns} ðsovereign${sovereigns > 1 ? 's' : ''}`;
  if (rest !== 0 && sovereigns !== 0) s += ' ðand ';
  if (rest !== 0) s += `ð${rest} ðroyal${rest > 1 ? 's' : ''}`;
  return s;
}

export class TextVariables {
  /** Values of `@0` to `@9`, as set so far. */
  readonly values = new Map<number, string>();
  /** Character index each variable was filled from (0xff: none); what "who" values of later actions address. */
  readonly characters: number[] = new Array(8).fill(0xff);

  constructor(private readonly ctx: TextVariableContext) {
    this.setDefaults();
  }

  /** The character a skill check just picked (what `@` source 12 reads). */
  setSkillChecked(index: number): void {
    this.ctx.skillCheckedCharacter = index;
  }

  private rnd(n: number): number {
    return (this.ctx.random ?? ((k: number) => Math.floor(Math.random() * k)))(n);
  }

  nameOf(index: number): string | undefined {
    return this.ctx.party.characters.find((c) => c.index === index)?.name;
  }

  /** What `resolveSpeaker` needs to turn a snippet's actor into a character. */
  speakerContext(keywords: readonly string[]): SpeakerContext {
    return {
      keywords,
      dialogCharacters: this.characters,
      leader: this.leader(),
      firstActive: this.ctx.party.activeCharacters[0],
      characterName: (i) => this.nameOf(i),
    };
  }

  /** The party leader: Pug if he is in the party, else the chapter's. */
  leader(): number {
    const active = this.ctx.party.activeCharacters;
    if (active.includes(CHAR_PUG)) return CHAR_PUG;
    const chapter = Math.min(9, Math.max(1, this.ctx.chapter ?? 1));
    return LEADER_PER_CHAPTER[chapter - 1]!;
  }

  /** Name of the active character: the one the dialogue concerns, else the leader, else the first in the party. */
  activeName(): string {
    const first = this.ctx.party.activeCharacters[0];
    for (const i of [this.ctx.activeCharacter, this.leader(), first]) {
      const name = i === undefined ? undefined : this.nameOf(i);
      if (name !== undefined) return name;
    }
    return '';
  }

  /**
   * What a dialogue starts with: `@4` is the leader, `@5`, `@3` and `@0` are distinct random party
   * members (the original draws them in that order).
   */
  setDefaults(): void {
    this.values.clear();
    this.characters.fill(0xff);
    if (this.ctx.party.activeCharacters.length === 0) return;
    this.set(4, 7);
    this.set(5, 0xf);
    this.set(3, 0xe);
    this.set(0, 0x1f);
  }

  /** SetTextVariable: fill `@which` from the source `what` (the attribute codes of dialogue.md 6.1). */
  set(which: number, what: number): void {
    if (which < 0 || which > 9) return;
    const c = this.ctx;
    const fromCharacter = (index: number | undefined) => {
      const name = index === undefined ? undefined : this.nameOf(index);
      if (index !== undefined && name !== undefined) {
        this.values.set(which, name);
        this.characters[which] = index;
      }
    };
    switch (what - 1) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
        fromCharacter(what - 1);
        break;
      case 6:
        fromCharacter(this.leader());
        break;
      case 10:
        fromCharacter(c.activeCharacter ?? this.leader());
        break;
      case 11:
        fromCharacter(c.skillCheckedCharacter);
        break;
      case 12:
      case 13:
      case 14:
      case 15:
      case 30:
        this.pickRandom(which, what);
        break;
      case 16:
        this.values.set(which, c.monsterName ?? 'No Monster Specified');
        break;
      case 17:
        this.values.set(which, c.itemName ?? '');
        break;
      case 18:
        this.values.set(which, moneyString(c.itemValue ?? 0));
        break;
      case 19:
        this.values.set(which, moneyString(c.party.gold));
        break;
      case 20:
      case 21:
      case 9:
      case 29:
        // Health points left and values this port does not track: shown as nothing.
        this.values.set(which, '');
        break;
      case 27:
        this.values.set(which, c.keeperName ?? 'shopkeeper');
        break;
      case 28:
        this.values.set(which, c.improvedSkill === undefined ? '' : skillLabel(c.improvedSkill));
        break;
      default:
        break;
    }
  }

  /** `@` followed by one digit, or a bare `@`. Variables never set keep the active character's name. */
  substitute(text: string): string {
    if (!text.includes('@')) return text;
    return text.replace(/@(\d)?/g, (_m, d: string | undefined) => {
      if (d === undefined) return this.activeName();
      return this.values.get(Number(d)) ?? this.activeName();
    });
  }

  private pickRandom(which: number, what: number): void {
    const active = this.ctx.party.activeCharacters.filter((i) => this.nameOf(i) !== undefined);
    if (active.length === 0) return;
    const leader = this.leader();
    const taken = (i: number) => this.characters.some((c, slot) => slot !== which && c === i);
    const accepts = (i: number): boolean => {
      switch (what) {
        case 14:
          return i === CHAR_OWYN || i === CHAR_PUG || i === CHAR_PATRUS; // magicians
        case 15:
          return i === CHAR_LOCKLEAR || i === CHAR_GORATH || i === CHAR_JAMES; // swordsmen
        case 16:
          return i === CHAR_GORATH || i === CHAR_PATRUS;
        case 31:
          return i !== leader;
        default:
          return true;
      }
    };
    // The original retries random picks up to 0x1f8 times, then keeps the last one; this deals from
    // the eligible members directly and falls back to the leader (or anyone) when nobody fits.
    const eligible = active.filter((i) => !taken(i) && accepts(i));
    const pool = eligible.length > 0 ? eligible : active.includes(leader) ? [leader] : active;
    const index = pool[this.rnd(pool.length)]!;
    this.values.set(which, this.nameOf(index)!);
    this.characters[which] = index;
  }
}

/** Skill name for an improved-skill index (SetTextVariable source 0x1d). */
export function skillLabel(index: number): string {
  const name = SKILL_NAMES[index];
  return name ? name[0]!.toUpperCase() + name.slice(1) : '';
}
