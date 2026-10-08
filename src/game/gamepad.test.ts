import { describe, expect, it } from 'vitest';
import { deadzone, keyForCode, padFrame, type PadSnapshot } from './gamepad';

const snap = (buttons: number[] = [], axes: number[] = [0, 0, 0, 0]): PadSnapshot => ({ buttons: Array.from({ length: 16 }, (_, i) => buttons.includes(i)), axes });

describe('gamepad', () => {
  it('applies a rescaled dead zone', () => {
    expect(deadzone(0.1)).toBe(0);
    expect(deadzone(-0.15)).toBe(0);
    expect(deadzone(1)).toBe(1);
    expect(deadzone(-1)).toBe(-1);
    expect(deadzone(0.6)).toBeCloseTo(0.5, 9);
    expect(deadzone(NaN)).toBe(0);
  });
  it('walks and turns with the sticks in the world (stick up is forward, stick left turns left)', () => {
    const { frame } = padFrame(snap([], [-1, -1, 0, 0]), [], 'world');
    expect(frame.moveAxis).toBe(1);
    expect(frame.turnAxis).toBe(1);
    expect(padFrame(snap([], [0, 0, 1, 0]), [], 'world').frame.turnAxis).toBe(-1);
    expect(padFrame(snap([7]), [], 'world').frame.run).toBe(true);
    expect(padFrame(snap([12]), [], 'world').frame.moveAxis).toBe(1);
  });
  it('presses keys once per button push', () => {
    const first = padFrame(snap([0]), [], 'world');
    expect(first.frame.presses).toEqual(['KeyE']);
    expect(padFrame(snap([0]), first.pressed, 'world').frame.presses).toEqual([]);
    expect(padFrame(snap([9]), [], 'world').frame.presses).toEqual(['Escape']);
  });
  it('navigates screens with the d-pad or the stick, and does not walk', () => {
    const dpad = padFrame(snap([13, 0]), [], 'screen');
    expect(dpad.frame.presses.sort()).toEqual(['ArrowDown', 'Enter']);
    expect(dpad.frame.moveAxis).toBe(0);
    const stick = padFrame(snap([], [0, 1, 0, 0]), [], 'screen');
    expect(stick.frame.presses).toEqual(['ArrowDown']);
    expect(padFrame(snap([], [0, 1, 0, 0]), stick.pressed, 'screen').frame.presses).toEqual([]);
    expect(padFrame(snap([1]), [], 'screen').frame.presses).toEqual(['Escape']);
  });
  it('maps the face buttons to combat commands', () => {
    expect(padFrame(snap([2, 3, 1, 6]), [], 'combat').frame.presses.sort()).toEqual(['KeyD', 'KeyF', 'KeyQ', 'KeyS']);
  });
  it('derives the key value from the code', () => {
    expect(keyForCode('KeyE')).toBe('e');
    expect(keyForCode('Enter')).toBe('Enter');
  });
});
