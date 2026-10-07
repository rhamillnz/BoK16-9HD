import { describe, expect, it } from 'vitest';
import { parseSpells, SpellCalc } from '../src/formats/spells';

/** Hand-built SPELLS.DAT: count, 11 u16 per spell, a gap word, then the names. */
function build(rows: number[][], names: string[]): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  u16(rows.length);
  let off = 0;
  rows.forEach((r, i) => { u16(off); r.forEach(u16); off += names[i]!.length + 1; });
  u16(0);
  for (const n of names) { for (const ch of n) out.push(ch.charCodeAt(0)); out.push(0); }
  return Uint8Array.from(out);
}

describe('parseSpells', () => {
  it('reads costs, flags, optional fields and names', () => {
    // minCost, maxCost, combat, targeting, color, anim, object, calc, damage, duration
    const bytes = build([[3, 9, 1, 0, 0xffff, 12, 0xffff, SpellCalc.CostTimesDamage, 2, 0], [1, 1, 0, 2, 4, 0xffff, 77, SpellCalc.FixedAmount, 0xfff6, 5]], ['Flamecast', 'Mend']);
    const [a, b] = parseSpells(bytes);
    expect(a).toMatchObject({ index: 0, name: 'Flamecast', minCost: 3, maxCost: 9, combat: true, targeting: 0, animation: 12, calc: SpellCalc.CostTimesDamage, damage: 2 });
    expect(a).not.toHaveProperty('color');
    expect(b).toMatchObject({ index: 1, name: 'Mend', combat: false, targeting: 2, color: 4, objectRequired: 77, damage: -10, duration: 5 });
    expect(b).not.toHaveProperty('animation');
  });
});
