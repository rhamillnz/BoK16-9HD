import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, codeLabel, isBound, parseBindings, rebind, serializeBindings } from './bindings';

describe('bindings', () => {
  it('round-trips and falls back per action', () => {
    const b = rebind(DEFAULT_BINDINGS, 'forward', 'KeyI')!;
    expect(parseBindings(serializeBindings(b))).toEqual(b);
    expect(parseBindings(null)).toEqual(DEFAULT_BINDINGS);
    expect(parseBindings('{oops')).toEqual(DEFAULT_BINDINGS);
    expect(parseBindings('{"forward":["KeyZ"],"back":["KeyX","KeyY"]}')).toMatchObject({
      forward: DEFAULT_BINDINGS.forward,
      back: ['KeyX', 'KeyY'],
    });
  });
  it('rebinds slot 0 and keeps slot 1', () => {
    const b = rebind(DEFAULT_BINDINGS, 'forward', 'KeyT')!;
    expect(b.forward).toEqual(['KeyT', 'ArrowUp']);
    expect(isBound(b, 'forward', 'KeyW')).toBe(false);
  });
  it('swaps when the key was already taken so no key drives two actions', () => {
    const b = rebind(DEFAULT_BINDINGS, 'forward', 'KeyS')!;
    expect(b.forward[0]).toBe('KeyS');
    expect(b.back[0]).toBe('KeyW');
    const all = Object.values(b).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it('refuses reserved keys', () => {
    expect(rebind(DEFAULT_BINDINGS, 'forward', 'Escape')).toBeUndefined();
    expect(rebind(DEFAULT_BINDINGS, 'run', 'F5')).toBeUndefined();
  });
  it('names keys readably', () => {
    expect(codeLabel('KeyW')).toBe('W');
    expect(codeLabel('ArrowUp')).toBe('Up');
    expect(codeLabel('ShiftLeft')).toBe('Shift Left');
  });
});
