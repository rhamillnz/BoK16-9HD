import { describe, expect, it } from 'vitest';
import {
  beginCombat,
  canFlee,
  checkCombatFinished,
  defend,
  finishTurn,
  flee,
  isActive,
  killCombatant,
  newCombatant,
  rest,
  roundOrder,
  selectNextCombatant,
  startNextRound,
  type TurnCombatant,
} from '../src/combat/turns';

const party = (id: string, speed: number) => newCombatant(id, 'party', speed, 20);
const enemy = (id: string, speed: number) => newCombatant(id, 'enemy', speed, 20);
const ids = (cs: TurnCombatant[], order: number[]) => order.map((i) => cs[i]!.id);

describe('turn selection', () => {
  const cs = [party('a', 5), enemy('x', 9), party('b', 7), enemy('y', 2)];

  it('picks the fastest pending combatant', () => {
    expect(selectNextCombatant(cs)).toBe(1);
  });

  it('can be restricted to the party', () => {
    expect(selectNextCombatant(cs, true)).toBe(2);
  });

  it('gives ties to the later combatant', () => {
    expect(selectNextCombatant([party('a', 4), enemy('x', 4)])).toBe(1);
  });

  it('treats zero speed as 1', () => {
    expect(selectNextCombatant([party('a', 0), enemy('x', 1)])).toBe(1);
    expect(selectNextCombatant([enemy('x', 1), party('a', 0)])).toBe(1);
  });

  it('skips the dead, incapacitated, exorcised, fled and those who have acted', () => {
    const base = party('a', 1);
    expect(isActive(base)).toBe(true);
    for (const patch of [{ dead: true }, { incapacitated: true }, { exorcised: true }, { fled: true }, { turnPending: false }]) {
      expect(isActive({ ...base, ...patch })).toBe(false);
    }
    expect(selectNextCombatant([{ ...base, dead: true }])).toBe(-1);
  });

  it('lists the whole round in order', () => {
    expect(ids(cs, roundOrder(cs))).toEqual(['x', 'b', 'a', 'y']);
  });
});

describe('combat flow', () => {
  it('opens with the fastest party member', () => {
    const s = beginCombat([enemy('x', 9), party('a', 3), party('b', 6)]);
    expect(s.combatants[s.current]!.id).toBe('b');
    expect(s.round).toBe(1);
  });

  it('refuses to begin without an active party member', () => {
    expect(() => beginCombat([enemy('x', 1)])).toThrow(/party member/);
  });

  it('runs a round in speed order, then starts the next', () => {
    let s = beginCombat([party('a', 5), enemy('x', 9), party('b', 7), enemy('y', 2)]);
    const order: string[] = [];
    // First turn is the fastest party member, then everyone else by speed.
    order.push(s.combatants[s.current]!.id);
    s = finishTurn(s);
    order.push(s.combatants[s.current]!.id);
    s = finishTurn(s);
    order.push(s.combatants[s.current]!.id);
    s = finishTurn(s);
    order.push(s.combatants[s.current]!.id);
    expect(order).toEqual(['b', 'x', 'a', 'y']);
    expect(s.round).toBe(1);
    s = finishTurn(s);
    expect(s.round).toBe(2);
    expect(s.combatants[s.current]!.id).toBe('x');
    expect(s.combatants.every((c) => c.turnPending)).toBe(true);
  });

  it('skips combatants that die mid-round', () => {
    let s = beginCombat([party('a', 5), enemy('x', 9), enemy('y', 2)]);
    s = finishTurn(s); // a done, x next
    expect(s.combatants[s.current]!.id).toBe('x');
    s = killCombatant(s, 2); // y dies
    s = finishTurn(s); // x done; y dead so round rolls over
    expect(s.round).toBe(2);
    expect(s.combatants[s.current]!.id).toBe('x');
  });

  it('wins when the last enemy dies and loses when the last party member does', () => {
    let s = beginCombat([party('a', 5), enemy('x', 9)]);
    s = finishTurn(killCombatant(s, 1));
    expect(s.outcome).toBe('won');

    let t = beginCombat([party('a', 5), enemy('x', 9)]);
    t = finishTurn(killCombatant(t, 0));
    expect(t.outcome).toBe('dead');
    expect(finishTurn(t)).toBe(t);
  });

  it('applies poison at the end of the poisoned combatant\'s turn', () => {
    let s = beginCombat([{ ...party('a', 5), poisoned: true, health: 3 }, enemy('x', 1)]);
    s = finishTurn(s, { poisonDamage: 2 });
    expect(s.combatants[0]!.health).toBe(1);
    expect(s.combatants[0]!.dead).toBe(false);
    s = finishTurn(s); // x
    s = finishTurn(s, { poisonDamage: 2 }); // a again, round 2
    expect(s.combatants[0]!.dead).toBe(true);
    expect(s.outcome).toBe('dead');
  });

  it('defending ends the turn and lasts until the next round', () => {
    let s = beginCombat([party('a', 5), enemy('x', 1)]);
    s = defend(s);
    expect(s.combatants[0]!.defending).toBe(true);
    expect(s.combatants[0]!.turnPending).toBe(false);
    s = rest(s); // x acts, round rolls over
    expect(s.round).toBe(2);
    expect(s.combatants[0]!.defending).toBe(false);
  });

  it('does not give exorcised combatants a new round, and does not count them as standing', () => {
    const cs = startNextRound([party('a', 1), { ...enemy('g', 1), exorcised: true, turnPending: false }]);
    expect(cs[1]!.turnPending).toBe(false);
    expect(checkCombatFinished(cs)).toBe('won');
  });

  it('keeps incapacitated combatants in the fight without turns', () => {
    const cs = [party('a', 1), { ...enemy('x', 9), incapacitated: true }];
    expect(checkCombatFinished(cs)).toBeUndefined();
    expect(selectNextCombatant(cs)).toBe(0);
  });
});

describe('fleeing', () => {
  it('succeeds unless more than one party member is dead', () => {
    const base = [party('a', 1), party('b', 1), party('c', 1), enemy('x', 1)];
    expect(canFlee(base)).toBe(true);
    expect(canFlee([{ ...base[0]!, dead: true }, ...base.slice(1)])).toBe(true);
    expect(canFlee([{ ...base[0]!, dead: true }, { ...base[1]!, dead: true }, ...base.slice(2)])).toBe(false);
  });

  it('ends the combat as fled when allowed', () => {
    const s = beginCombat([party('a', 1), enemy('x', 1)]);
    expect(flee(s).outcome).toBe('fled');
    const bad = beginCombat([party('a', 3), { ...party('b', 1), dead: true }, { ...party('c', 1), dead: true }, enemy('x', 1)]);
    expect(flee(bad).outcome).toBeUndefined();
  });
});
