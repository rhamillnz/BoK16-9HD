import { describe, expect, it } from 'vitest';
import type { Font, Glyph } from '../src/formats/fnt';
import type { Character, GamSave, Skill } from '../src/formats/gam';
import { SKILL_NAMES, CONDITION_NAMES } from '../src/formats/gam';
import { HudScreens } from '../src/ui/hud';

function testFont(): Font {
  const glyphs: Glyph[] = [];
  for (let code = 32; code < 127; code++)
    glyphs.push({ code, width: 4, height: 6, pixels: new Uint8Array(24).fill(code === 32 ? 0 : 1) });
  return { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };
}

function character(index: number, name: string): Character {
  const skill = {
    max: 50,
    trueSkill: 40,
    current: 40,
    modifier: 0,
    selected: false,
    unseenImprovement: false,
  } as unknown as Skill;
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

const save = {
  characters: [character(0, 'Owyn'), character(1, 'Pug')],
  activeCharacters: [0, 1],
} as unknown as GamSave;
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

  it('cancels a dialogue when Escape closes it', () => {
    const h = hud();
    const results: string[] = [];
    h.showDialog({ text: 'Hi', displayStyle3: 0 }, [], (r) => results.push(r.kind));
    h.keyDown('Escape', 'Escape');
    expect(results).toEqual(['cancel']);
    expect(h.blocking).toBe(false);
  });

  describe('town scene', () => {
    const spot = {
      index: 0,
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      chapterMask: 0,
      keyword: 1,
      action: 2,
      unknownD: 0,
      arg1: 0,
      arg2: 0,
      arg3: 0,
      tooltip: 0,
      unknown1a: 0,
      dialog: 0,
      checkEventState: 0,
    };
    function openTown() {
      const h = hud();
      const calls: string[] = [];
      h.showTown({
        picture: {} as CanvasImageSource,
        hotspots: [spot],
        onClick: () => calls.push('click'),
        onDescribe: () => calls.push('describe'),
        onLeave: () => calls.push('leave'),
      });
      return { h, calls };
    }
    const middle = (h: ReturnType<typeof hud>) => [h.width / 2, h.height / 2] as const;

    it('blocks movement, ignores the inventory and sheet keys, and Escape asks to leave', () => {
      const { h, calls } = openTown();
      expect(h.screen).toBe('town');
      expect(h.blocking).toBe(true);
      h.keyDown('KeyI', 'i');
      h.keyDown('KeyC', 'c');
      expect(h.screen).toBe('town');
      expect(h.keyDown('Escape', 'Escape')).toBe(true);
      expect(calls).toEqual(['leave']);
      expect(h.screen).toBe('town'); // the controller decides when the scene closes
    });

    it('sends left clicks and right clicks on a hotspot to the scene', () => {
      const { h, calls } = openTown();
      h.click(...middle(h));
      h.rightClick(...middle(h));
      h.click(1, 1);
      expect(calls).toEqual(['click', 'describe']);
    });

    it('plays dialogue on top of the scene and returns to it afterwards', () => {
      const { h } = openTown();
      const results: string[] = [];
      h.showDialog({ text: 'Welcome', displayStyle3: 0 }, [], (r) => results.push(r.kind));
      expect(h.screen).toBe('dialog');
      h.keyDown('Enter', 'Enter');
      expect(results).toEqual(['finish']);
      expect(h.screen).toBe('town');
      h.showDialog({ text: 'Again', displayStyle3: 0 }, [], (r) => results.push(r.kind));
      h.keyDown('Escape', 'Escape'); // closes the dialogue, not the scene
      expect(results).toEqual(['finish', 'cancel']);
      expect(h.screen).toBe('town');
    });

    it('hideTown closes the scene and any dialogue above it', () => {
      const { h } = openTown();
      const results: string[] = [];
      h.showDialog({ text: 'Hi', displayStyle3: 0 }, [], (r) => results.push(r.kind));
      h.hideTown();
      expect(results).toEqual(['cancel']);
      expect(h.screen).toBe('none');
      expect(h.blocking).toBe(false);
    });
  });
});

describe('screen registry', () => {
  it('lets a feature register a screen with a hotkey that toggles, blocks and closes', () => {
    const seen: string[] = [];
    const h = hud();
    h.register('shop', () => ({
      hotkey: 'KeyB',
      open: () => {
        seen.push('open');
      },
      event: (ev) => {
        seen.push(ev.type);
      },
      draw: () => {
        seen.push('draw');
      },
      close: () => {
        seen.push('close');
      },
    }));
    expect(h.keyDown('KeyB', 'b')).toBe(true);
    expect(h.screen).toBe('shop');
    expect(h.blocking).toBe(true);
    h.click(1, 1);
    h.rightClick(1, 1); // dropped: the screen did not ask for right clicks
    expect(seen).toEqual(['open', 'click']);
    h.keyDown('KeyB', 'b');
    expect(h.screen).toBe('none');
    expect(seen.at(-1)).toBe('close');
  });

  it('lets open() refuse and rejects unknown screens', () => {
    const h = hud();
    h.register('never', () => ({ open: () => false, event: () => {}, draw: () => {} }));
    h.open('never');
    expect(h.screen).toBe('none');
    expect(() => h.open('missing')).toThrow();
  });
});
