import { describe, expect, it } from 'vitest';
import { stripTextCodes, tokenizeText } from '../src/formats/textCodes';

const runs = (t: string) => tokenizeText(t).map((p) => p.map((r) => [r.text, Object.entries(r.style).filter(([, v]) => v).map(([k]) => k)]));

describe('tokenizeText', () => {
  it('returns plain text as one run', () => {
    expect(runs('Hello there')).toEqual([[['Hello there', []]]]);
  });
  it('drops a leading 0xF3 and styles the word italic until the space', () => {
    expect(runs('\xf3Hello world')).toEqual([[['Hello ', ['italic']], ['world', []]]]);
  });
  it('emphasis 0xF0/0xF1 ends at the next space', () => {
    expect(runs('a \xf0b\xf1c d')).toEqual([[['a ', []], ['bc ', ['emphasis']], ['d', []]]]);
  });
  it('# toggles bold', () => {
    expect(runs('a #b c# d')).toEqual([[['a ', []], ['b c', ['bold']], [' d', []]]]);
  });
  it('toggles red, white, inactive, unbold and moredhel', () => {
    for (const [code, name] of [[0xf5, 'red'], [0xf6, 'white'], [0xf9, 'inactive'], [0xf4, 'unbold'], [0xf7, 'moredhel']] as const) {
      const c = String.fromCharCode(code);
      expect(runs(`a${c}b${c}c`)).toEqual([[['a', []], ['b', [name]], ['c', []]]]);
    }
  });
  it('newline starts a paragraph, resets toggles but keeps bold', () => {
    expect(runs('#a\xf5b\nc#')).toEqual([[['a', ['bold']], ['b', ['bold', 'red']]], [['c', ['bold']]]]);
  });
  it('0xF8 is a forced line break inside the paragraph', () => {
    expect(tokenizeText('a\xf8b')[0]!.map((r) => r.text).join('')).toBe('a\nb');
  });
  it('tab is four spaces and clears bold; 0xE1-E3 are spaces', () => {
    expect(stripTextCodes('a\tb')).toBe('a    b');
    expect(stripTextCodes('a\xe1b\xe2c\xe3d')).toBe('a b c d');
    expect(runs('#a\tb')).toEqual([[['a    ', ['bold']], ['b', []]]]);
  });
  it('silently drops unknown control bytes', () => {
    expect(stripTextCodes('a\x01\xf2\xfa\xffb')).toBe('ab');
  });
  it('drops empty paragraphs and trims', () => {
    expect(stripTextCodes('\n  one \n\n two\n')).toBe('one\ntwo');
  });
  it('keeps printable Latin-1 above 0x7f that are not codes', () => {
    expect(stripTextCodes('caf\xe9')).toBe('caf\xe9');
  });
});
