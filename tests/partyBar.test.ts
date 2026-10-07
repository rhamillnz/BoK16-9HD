import { describe, expect, it } from 'vitest';
import type { Font, Glyph } from '../src/formats/fnt';
import {
  CONDITION_NAMES,
  SKILL_NAMES,
  type Character,
  type ConditionName,
  type Skill,
  type SkillName,
} from '../src/formats/gam';
import {
  buildPartyBar,
  buildPartyBarMember,
  ellipsize,
  fraction,
  layoutPartyBar,
  partySlotAt,
} from '../src/ui/partyBar';

const glyphs: Glyph[] = [];
for (let code = 32; code < 127; code++) glyphs.push({ code, width: 4, height: 6, pixels: new Uint8Array(24).fill(1) });
const font: Font = { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };

function character(index: number, name: string, over: Partial<Record<SkillName, Partial<Skill>>> = {}): Character {
  const skills = {} as Record<SkillName, Skill>;
  for (const s of SKILL_NAMES)
    skills[s] = {
      max: 50,
      trueSkill: 50,
      current: 0,
      experience: 0,
      modifier: 0,
      selected: false,
      unseenImprovement: false,
      ...over[s],
    };
  const conditions = {} as Record<ConditionName, number>;
  for (const c of CONDITION_NAMES) conditions[c] = 0;
  return {
    index,
    name,
    unknownHeader: new Uint8Array(2),
    spellBytes: new Uint8Array(6),
    spells: [],
    skills,
    combatCharIndex: 0,
    unknownTrailer: new Uint8Array(6),
    conditions,
    affectors: [],
    inventory: { capacity: 0, items: [] },
  };
}

describe('party bar model', () => {
  it('reads current values through effectiveSkill, not the cached current byte', () => {
    const m = buildPartyBarMember(
      character(2, 'Owyn', { health: { max: 60, trueSkill: 45 }, stamina: { max: 80, trueSkill: 20 } }),
    );
    expect(m.health).toBe(45);
    expect(m.stamina).toBe(20);
    expect(m.healthFraction).toBeCloseTo(0.75);
    expect(m.staminaFraction).toBeCloseTo(0.25);
    expect(m.down).toBe(false);
  });
  it('marks a member with no health as down and clamps fractions', () => {
    expect(buildPartyBarMember(character(0, 'X', { health: { trueSkill: 0 } })).down).toBe(true);
    expect(fraction(80, 50)).toBe(1);
    expect(fraction(5, 0)).toBe(0);
  });
  it('follows the active party order', () => {
    const chars = [character(0, 'A'), character(1, 'B'), character(2, 'C')];
    expect(buildPartyBar({ characters: chars, activeCharacters: [2, 0] }).map((m) => m.name)).toEqual(['C', 'A']);
  });
});

describe('party bar layout', () => {
  const opts = { canvasWidth: 2560, canvasHeight: 1440 };
  it('sits at the bottom, centred, with slots inside the panel and not overlapping', () => {
    const l = layoutPartyBar(font, 3, opts);
    expect(l.slots).toHaveLength(3);
    expect(l.panel.y + l.panel.height).toBe(1440);
    expect(Math.abs(l.panel.x + l.panel.width / 2 - 1280)).toBeLessThanOrEqual(1);
    for (const [i, s] of l.slots.entries()) {
      expect(s.rect.x).toBeGreaterThanOrEqual(l.panel.x);
      expect(s.rect.x + s.rect.width).toBeLessThanOrEqual(l.panel.x + l.panel.width);
      expect(s.healthBar.y + s.healthBar.height).toBeLessThanOrEqual(s.staminaBar.y);
      expect(s.staminaBar.y + s.staminaBar.height).toBeLessThanOrEqual(s.rect.y + s.rect.height);
      expect(s.healthBar.x).toBeGreaterThanOrEqual(s.portrait.x + s.portrait.width);
      if (i > 0) expect(s.rect.x).toBeGreaterThanOrEqual(l.slots[i - 1]!.rect.x + l.slots[i - 1]!.rect.width);
    }
  });
  it('has no slots for an empty party and caps at six', () => {
    expect(layoutPartyBar(font, 0, opts).slots).toHaveLength(0);
    expect(layoutPartyBar(font, 9, opts).slots).toHaveLength(6);
  });
  it('hit-tests slots', () => {
    const l = layoutPartyBar(font, 3, opts);
    const r = l.slots[1]!.rect;
    expect(partySlotAt(l, r.x + 1, r.y + 1)).toBe(1);
    expect(partySlotAt(l, 0, 0)).toBe(-1);
  });
  it('ellipsizes names that do not fit', () => {
    expect(ellipsize(font, 'Locklear', 100)).toBe('Locklear');
    const t = ellipsize(font, 'Sir Longname the Great', 40);
    expect(t.endsWith('...')).toBe(true);
    expect(t.length * 4).toBeLessThanOrEqual(40);
  });
});
