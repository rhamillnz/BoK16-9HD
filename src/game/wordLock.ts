/**
 * Word-lock riddle chests. The riddle text of a chest holds three parts separated by `\n#`: the
 * answer, a block of option rows (one per line, each as long as the answer) and a hint. Tumbler
 * `i` cycles through the `i`-th letter of every option row; the chest opens when the letters
 * showing spell the answer. See docs/formats/containers.md.
 */

/** Dialogue key of the first riddle text; chest `n` uses `WORD_LOCK_KEY_BASE + n`. */
export const WORD_LOCK_KEY_BASE = 0x19f0a0;
/** At most this many tumblers fit on the screen. */
export const MAX_TUMBLERS = 15;

export const wordLockKey = (fairyChestIndex: number): number => WORD_LOCK_KEY_BASE + fairyChestIndex;

export interface WordLockPuzzle {
  answer: string;
  options: string[];
  hint: string;
}

/** Parse the riddle text; undefined when it does not have the three parts or the rows do not match the answer. */
export function parseWordLock(text: string): WordLockPuzzle | undefined {
  const parts = text.replace(/\r/g, '').split('\n#');
  if (parts.length !== 3) return undefined;
  const answer = parts[0]!.trim();
  const options = parts[1]!.split('\n').map((o) => o.trim()).filter((o) => o.length > 0);
  if (answer.length === 0 || answer.length > MAX_TUMBLERS || options.length === 0) return undefined;
  if (options.some((o) => o.length !== answer.length)) return undefined;
  return { answer, options, hint: parts[2]!.trim() };
}

export interface WordLockState {
  puzzle: WordLockPuzzle;
  /** For each tumbler, which option row it currently shows. */
  position: number[];
}

export function startWordLock(puzzle: WordLockPuzzle): WordLockState {
  return { puzzle, position: Array.from({ length: puzzle.answer.length }, () => 0) };
}

/** The letters currently showing. */
export function wordLockGuess(s: WordLockState): string {
  return s.position.map((p, i) => s.puzzle.options[p]![i]!).join('');
}

/** Turn tumbler `i` to its next letter. */
export function turnTumbler(s: WordLockState, i: number): WordLockState {
  if (i < 0 || i >= s.position.length) return s;
  const position = s.position.slice();
  position[i] = (position[i]! + 1) % s.puzzle.options.length;
  return { ...s, position };
}

export const isWordLockSolved = (s: WordLockState): boolean => wordLockGuess(s) === s.puzzle.answer;
