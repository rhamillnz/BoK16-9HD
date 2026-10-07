import { describe, expect, it } from 'vitest';
import { isWordLockSolved, parseWordLock, startWordLock, turnTumbler, wordLockGuess, wordLockKey } from './wordLock';

const TEXT = 'OAK\n#\nOAK\nASH\nELM\n#Which tree is the oldest?';

describe('word lock', () => {
  it('parses answer, option rows and hint', () => {
    expect(parseWordLock(TEXT)).toEqual({ answer: 'OAK', options: ['OAK', 'ASH', 'ELM'], hint: 'Which tree is the oldest?' });
    expect(parseWordLock(TEXT.replace(/\n/g, '\r\n'))?.answer).toBe('OAK');
  });

  it('rejects malformed riddles', () => {
    expect(parseWordLock('OAK only')).toBeUndefined();
    expect(parseWordLock('OAK\n#\nOA\nASH\n#hint')).toBeUndefined();
    expect(parseWordLock('\n#\nOAK\n#hint')).toBeUndefined();
    expect(parseWordLock(`${'A'.repeat(16)}\n#\n${'A'.repeat(16)}\n#hint`)).toBeUndefined();
  });

  it('turning tumblers cycles letters until the answer shows', () => {
    let s = startWordLock(parseWordLock('OAK\n#\nASH\nELM\nOAK\n#hint')!);
    expect(wordLockGuess(s)).toBe('ASH');
    s = turnTumbler(turnTumbler(s, 0), 0);
    s = turnTumbler(turnTumbler(s, 1), 1);
    s = turnTumbler(turnTumbler(s, 2), 2);
    expect(wordLockGuess(s)).toBe('OAK');
    expect(isWordLockSolved(s)).toBe(true);
    expect(isWordLockSolved(turnTumbler(s, 1))).toBe(false);
    expect(turnTumbler(s, 9)).toBe(s);
  });

  it('numbers riddle texts from the base key', () => {
    expect(wordLockKey(0)).toBe(0x19f0a0);
    expect(wordLockKey(5)).toBe(0x19f0a5);
  });
});
