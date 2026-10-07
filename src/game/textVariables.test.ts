import { describe, expect, it } from 'vitest';
import type { Character } from '../formats/gam';
import { CHAR_GORATH, CHAR_JAMES, CHAR_LOCKLEAR, CHAR_OWYN, CHAR_PUG, TextVariables, moneyString } from './textVariables';

const names = ['Locklear', 'Gorath', 'Owyn', 'Pug', 'James', 'Patrus'];
const party = (active: number[], gold = 0) => ({
  gold,
  characters: names.map((name, index) => ({ index, name }) as Character),
  activeCharacters: active,
});

describe('moneyString', () => {
  it('splits royals into sovereigns and royals with emphasis codes', () => {
    expect(moneyString(0)).toBe('');
    expect(moneyString(1)).toBe('ð1 ðroyal');
    expect(moneyString(30)).toBe('ð3 ðsovereigns');
    expect(moneyString(121)).toBe('ð12 ðsovereigns ðand ð1 ðroyal');
    expect(moneyString(10)).toBe('ð1 ðsovereign');
  });
});

describe('TextVariables', () => {
  it('starts with the leader in @4 and distinct party members in @5, @3 and @0', () => {
    const v = new TextVariables({ party: party([0, 1, 2, 3]), chapter: 1, random: () => 0 });
    expect(v.values.get(4)).toBe('Pug'); // Pug leads whenever present
    expect(v.substitute('@4 remarked')).toBe('Pug remarked');
    const picked = [5, 3, 0].map((n) => v.values.get(n));
    expect(new Set(picked).size).toBe(3);
  });

  it('uses the chapter leader without Pug', () => {
    expect(new TextVariables({ party: party([0, 4, 1]), chapter: 2 }).leader()).toBe(CHAR_JAMES);
    expect(new TextVariables({ party: party([0, 4, 1]), chapter: 1 }).leader()).toBe(CHAR_LOCKLEAR);
    expect(new TextVariables({ party: party([0, 4, 1]), chapter: 4 }).leader()).toBe(CHAR_GORATH);
  });

  it('SetTextVariable picks fixed characters, the leader and the active character', () => {
    const v = new TextVariables({ party: party([0, 1, 2]), chapter: 1, activeCharacter: CHAR_OWYN });
    v.set(1, 2); // attribute 2 = character 1
    expect(v.values.get(1)).toBe('Gorath');
    expect(v.characters[1]).toBe(CHAR_GORATH);
    v.set(2, 7);
    expect(v.values.get(2)).toBe('Locklear');
    v.set(2, 11);
    expect(v.values.get(2)).toBe('Owyn');
  });

  it('picks swordsmen and magicians by class and never repeats a character', () => {
    const v = new TextVariables({ party: party([0, 1, 2, 3]), chapter: 1, random: (n) => n - 1 });
    v.characters.fill(0xff); // forget the defaults
    v.set(6, 0xf);
    v.set(7, 0xf);
    expect(v.characters[6]).not.toBe(v.characters[7]);
    expect([CHAR_LOCKLEAR, CHAR_GORATH, CHAR_JAMES]).toContain(v.characters[6]);
    const w = new TextVariables({ party: party([0, 2, 3]), random: () => 0 });
    w.set(6, 0xe);
    expect([CHAR_OWYN, CHAR_PUG]).toContain(w.characters[6]);
  });

  it('fills money, item, monster, keeper and skill variables', () => {
    const v = new TextVariables({
      party: party([0], 25), itemName: 'Sword', itemValue: 10, monsterName: 'Moredhel',
      improvedSkill: 3, random: () => 0,
    });
    v.set(0, 0x13);
    expect(v.substitute('costs @0')).toBe('costs ð1 ðsovereign');
    v.set(0, 0x14);
    expect(v.values.get(0)).toBe('ð2 ðsovereigns ðand ð5 ðroyals');
    v.set(1, 0x12);
    v.set(2, 0x11);
    v.set(3, 0x1c);
    v.set(4, 0x1d);
    expect(v.substitute('@1 @2 @3 @4')).toBe('Sword Moredhel shopkeeper Strength');
  });

  it('replaces a bare @ with the active character, and an unset @N with the same', () => {
    const v = new TextVariables({ party: party([]), activeCharacter: CHAR_OWYN });
    expect(v.substitute('@ and @7 smile')).toBe('Owyn and Owyn smile');
    expect(v.substitute('no placeholders')).toBe('no placeholders');
    // @4 followed by a digit is still variable 4 and a literal digit
    const w = new TextVariables({ party: party([0]), random: () => 0 });
    expect(w.substitute('@45')).toBe('Locklear5');
  });

  it('ignores out-of-range variables and unknown sources', () => {
    const v = new TextVariables({ party: party([0]) });
    v.set(12, 7);
    v.set(1, 0x40);
    expect(v.values.has(12)).toBe(false);
    expect(v.values.has(1)).toBe(false);
  });
});
