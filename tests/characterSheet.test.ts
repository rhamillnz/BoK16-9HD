import { describe, expect, it } from 'vitest';
import type { Font, Glyph } from '../src/formats/fnt';
import { CONDITION_NAMES, SKILL_NAMES, type Character, type ConditionName, type Skill, type SkillName } from '../src/formats/gam';
import {
  buildSheetModel,
  formatSkillValue,
  layoutCharacterSheet,
  partyCharacters,
  stepSheet,
  tabAt,
  type SheetOptions,
} from '../src/ui/characterSheet';

function testFont(): Font {
  const glyphs: Glyph[] = [];
  for (let code = 32; code < 127; code++) glyphs.push({ code, width: 4, height: 6, pixels: new Uint8Array(24).fill(1) });
  return { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };
}
const font = testFont();
const opts: SheetOptions = { scale: 2, canvasWidth: 1280, canvasHeight: 720 };

function character(index: number, name: string, over: Partial<Record<SkillName, Partial<Skill>>> = {}, cond: Partial<Record<ConditionName, number>> = {}): Character {
  const skills = {} as Record<SkillName, Skill>;
  for (const s of SKILL_NAMES) {
    skills[s] = { max: 50, trueSkill: 50, current: 25, experience: 0, modifier: 0, selected: false, unseenImprovement: false, ...over[s] };
  }
  const conditions = {} as Record<ConditionName, number>;
  for (const c of CONDITION_NAMES) conditions[c] = cond[c] ?? 0;
  return {
    index, name, unknownHeader: new Uint8Array(2), spellBytes: new Uint8Array(6), spells: [1, 5], skills,
    combatCharIndex: 0, unknownTrailer: new Uint8Array(6), conditions, affectors: [], inventory: { capacity: 0, items: [] },
  };
}

describe('sheet model', () => {
  it('splits skills into vitals, attributes and learned skills', () => {
    const m = buildSheetModel(character(0, 'Owyn', { health: { trueSkill: 10, max: 40 } }));
    expect(m.vitals.map((r) => r.skill)).toEqual(['health', 'stamina']);
    expect(m.attributes.map((r) => r.skill)).toEqual(['speed', 'strength', 'defense']);
    expect(m.skills).toHaveLength(11);
    expect(m.vitals[0]!.fraction).toBeCloseTo(0.25);
    expect(m.spellCount).toBe(2);
  });
  it('shows the recomputed value when the saved current byte is 0', () => {
    const m = buildSheetModel(character(0, 'Locklear', { health: { current: 0, trueSkill: 55, max: 55 }, lockpick: { current: 0, trueSkill: 40, max: 50 } }));
    expect(m.vitals[0]!.current).toBe(55);
    expect(m.vitals[0]!.fraction).toBe(1);
    expect(m.skills.find((r) => r.skill === 'lockpick')!.current).toBe(40);
  });
  it('keeps only non-zero conditions in canonical order', () => {
    const m = buildSheetModel(character(0, 'Pug', {}, { starving: 20, poisoned: 5 }));
    expect(m.conditions.map((c) => c.name)).toEqual(['poisoned', 'starving']);
  });
  it('guards zero max and clamps overfull bars', () => {
    const m = buildSheetModel(character(0, 'X', { speed: { max: 0, trueSkill: 0 }, strength: { max: 10, trueSkill: 30 } }));
    expect(m.attributes[0]!.fraction).toBe(0);
    expect(m.attributes[1]!.fraction).toBe(1);
  });
  it('formats values with signed modifiers', () => {
    expect(formatSkillValue({ current: 45, max: 60, modifier: 0 })).toBe('45/60');
    expect(formatSkillValue({ current: 45, max: 60, modifier: 5 })).toBe('45/60 (+5)');
    expect(formatSkillValue({ current: 45, max: 60, modifier: -3 })).toBe('45/60 (-3)');
  });
  it('lists the active party in order', () => {
    const characters = [0, 1, 2, 3, 4, 5].map((i) => character(i, `C${i}`));
    expect(partyCharacters({ characters, activeCharacters: [3, 1, 9] }).map((c) => c.name)).toEqual(['C3', 'C1']);
  });
});

describe('layout', () => {
  const model = buildSheetModel(character(0, 'Owyn', {}, { sick: 10, drunk: 3 }));
  const layout = layoutCharacterSheet(font, model, ['Owyn', 'Pug', 'Gorath'], opts);
  const inside = (r: { x: number; y: number; width: number; height: number }) =>
    r.x >= layout.panel.x && r.y >= layout.panel.y && r.x + r.width <= layout.panel.x + layout.panel.width && r.y + r.height <= layout.panel.y + layout.panel.height;

  it('centres the panel in the canvas', () => {
    expect(layout.panel.x * 2 + layout.panel.width).toBe(1280);
    expect(layout.panel.y * 2 + layout.panel.height).toBe(720);
  });
  it('keeps every element inside the panel', () => {
    const all = [...layout.tabs.map((t) => t.rect), ...[...layout.vitals, ...layout.attributes, ...layout.skills].map((r) => r.rect), ...layout.conditions.map((c) => c.rect)];
    for (const r of all) expect(inside(r)).toBe(true);
  });
  it('places rows without overlap and bars inside rows', () => {
    const rows = [...layout.vitals, ...layout.attributes];
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.rect.y).toBeGreaterThanOrEqual(rows[i - 1]!.rect.y + layout.rowHeight);
    for (const r of [...rows, ...layout.skills]) {
      expect(r.bar.width).toBeGreaterThan(0);
      expect(r.bar.x + r.bar.width).toBeLessThanOrEqual(r.value.x);
    }
  });
  it('puts learned skills in a right column and conditions below attributes', () => {
    expect(layout.skills[0]!.rect.x).toBeGreaterThan(layout.vitals[0]!.rect.x + layout.vitals[0]!.rect.width);
    expect(layout.conditions).toHaveLength(2);
    expect(layout.conditions[0]!.rect.y).toBeGreaterThan(layout.attributes.at(-1)!.rect.y);
  });
  it('hit-tests tabs', () => {
    const t = layout.tabs[1]!.rect;
    expect(tabAt(layout, t.x + 1, t.y + 1)).toBe(1);
    expect(tabAt(layout, 0, 0)).toBe(-1);
  });
});

describe('input', () => {
  const model = buildSheetModel(character(0, 'Owyn'));
  const layout = layoutCharacterSheet(font, model, ['A', 'B', 'C'], opts);
  const key = (k: string) => ({ type: 'key', key: k }) as const;

  it('cycles tabs with arrows and wraps', () => {
    expect(stepSheet(layout, { tab: 2 }, key('ArrowRight'))).toEqual({ state: { tab: 0 }, result: { kind: 'select', tab: 0 } });
    expect(stepSheet(layout, { tab: 0 }, key('ArrowLeft')).state.tab).toBe(2);
  });
  it('picks by digit, ignoring out-of-range digits', () => {
    expect(stepSheet(layout, { tab: 0 }, key('3')).state.tab).toBe(2);
    expect(stepSheet(layout, { tab: 0 }, key('6')).result).toEqual({ kind: 'none' });
  });
  it('selects on click and closes on Escape', () => {
    const r = layout.tabs[2]!.rect;
    expect(stepSheet(layout, { tab: 0 }, { type: 'click', x: r.x + 1, y: r.y + 1 }).result).toEqual({ kind: 'select', tab: 2 });
    expect(stepSheet(layout, { tab: 0 }, key('Escape')).result).toEqual({ kind: 'close' });
  });
  it('handles an empty party', () => {
    const empty = layoutCharacterSheet(font, model, [], opts);
    expect(stepSheet(empty, { tab: 0 }, key('ArrowRight')).result).toEqual({ kind: 'none' });
  });
});
