import { describe, expect, it } from 'vitest';
import type { Font, Glyph } from '../src/formats/fnt';
import type { Character, GamSave, Skill } from '../src/formats/gam';
import { SKILL_NAMES, CONDITION_NAMES } from '../src/formats/gam';
import { HudScreens } from '../src/ui/hud';

function testFont(): Font {
  const glyphs: Glyph[] = [];
  for (let code = 32; code < 127; code++) glyphs.push({ code, width: 4, height: 6, pixels: new Uint8Array(24).fill(code === 32 ? 0 : 1) });
  return { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };
}

function character(index: number, name: string): Character {
  const skill = { max: 50, trueSkill: 40, current: 40, modifier: 0, selected: false, unseenImprovement: false } as unknown as Skill;
  return {
    index,
    name,
    spells: [],
    skills: Object.fromEntries(SKILL_NAMES.map((n) => [n, { ...skill }])),
    conditions: Object.fromEntries(CONDITION_NAMES.map((n) => [n, 0])),
    affectors: [],
    inventory: { capacity: 8, items: [] },
  } as unknown as Character;
}

const save = { characters: [character(0, 'Owyn'), character(1, 'Pug')], activeCharacters: [0, 1] } as unknown as GamSave;
const hud = () => new HudScreens({ font: testFont(), save, items: [] });

describe('HudScreens', () => {
  it('opens and closes screens with I, C and Escape, blocking movement while open', () => {
    const h = hud();
    expect(h.blocking).toBe(false);
    expect(h.keyDown('KeyW', 'w')).toBe(false);
    expect(h.keyDown('KeyI', 'i')).toBe(true);
    expect(h.screen).toBe('inventory');
    expect(h.blocking).toBe(true);
    h.keyDown('KeyC', 'c');
    expect(h.screen).toBe('sheet');
    h.keyDown('KeyC', 'c');
    expect(h.screen).toBe('none');
    h.keyDown('KeyI', 'i');
    h.keyDown('Escape', 'Escape');
    expect(h.screen).toBe('none');
    expect(h.blocking).toBe(false);
  });

  it('consumes keys while a screen is open and forwards them to it', () => {
    const h = hud();
    h.keyDown('KeyC', 'c');
    expect(h.keyDown('KeyW', 'w')).toBe(true);
    h.keyDown('Tab', 'Tab');
    expect(h.screen).toBe('sheet');
  });

  it('shows dialogue, reports the result and closes', () => {
    const h = hud();
    const results: string[] = [];
    h.showDialog({ text: 'Hello there', displayStyle3: 0 }, [], (r) => results.push(r.kind));
    expect(h.screen).toBe('dialog');
    h.keyDown('KeyI', 'i'); // ignored during dialogue
    expect(h.screen).toBe('dialog');
    h.keyDown('Enter', 'Enter');
    expect(results).toEqual(['finish']);
    expect(h.screen).toBe('none');
  });

  it('finishes a dialogue when Escape closes it', () => {
    const h = hud();
    const results: string[] = [];
    h.showDialog({ text: 'Hi', displayStyle3: 0 }, [], (r) => results.push(r.kind));
    h.keyDown('Escape', 'Escape');
    expect(results).toEqual(['finish']);
    expect(h.blocking).toBe(false);
  });
});
