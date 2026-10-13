import { describe, expect, it } from 'vitest';
import { NEVER_ENDING_COMBATS, postCombatFlags } from '../src/game/postCombat';
import { getFlag, setFlag, type WorldState } from '../src/game/state';

const world = (): WorldState => ({
  chapter: 1,
  ticks: 0,
  ticksLastSlept: 0,
  bytes: new Uint8Array(0x60000),
  expiringEvents: [],
});

describe('after a won fight', () => {
  it('sets the rusalki quest flag once all five are won', () => {
    let w = world();
    for (const f of [0x14e7, 0x14e8, 0x14e9, 0x14ea]) w = setFlag(w, f, true);
    expect(getFlag(postCombatFlags(w, 133), 0xdb1c)).toBe(false);
    w = setFlag(w, 0x14eb, true);
    expect(getFlag(postCombatFlags(w, 133), 0xdb1c)).toBe(true);
    expect(getFlag(postCombatFlags(w, 99), 0xdb1c)).toBe(false);
  });

  it('knows the fights that never stay won', () => {
    expect(NEVER_ENDING_COMBATS.has(235)).toBe(true);
    expect(NEVER_ENDING_COMBATS.has(131)).toBe(false);
  });
});
