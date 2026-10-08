import { describe, expect, it } from 'vitest';
import { initialMenuState, layoutMenu, stepMenu, type MenuModel } from '../src/ui/menuScreen';

const model: MenuModel = {
  title: 'Teleport',
  lines: ['From: Sung', 'You have: 5 royals'],
  rows: [
    { id: 'a', label: 'Alpha', detail: '3 royals' },
    { id: 'b', label: 'Beta', detail: '9 royals', enabled: false },
    { id: 'c', label: 'Gamma' },
  ],
  buttons: [{ id: 'cancel', label: 'Cancel' }],
};
const layout = layoutMenu(model);
const key = (key: string) => ({ type: 'key', key }) as const;
const centre = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe('menu screen', () => {
  it('fits on the HUD with rows above the buttons', () => {
    expect(layout.panel.y).toBeGreaterThanOrEqual(0);
    expect(layout.panel.y + layout.panel.height).toBeLessThanOrEqual(1440);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows[2]!.y + layout.rows[2]!.height).toBeLessThan(layout.buttons[0]!.y);
    expect(layout.buttons[0]!.y + layout.buttons[0]!.height).toBeLessThanOrEqual(layout.panel.y + layout.panel.height);
  });

  it('moves over enabled entries only and picks with Enter', () => {
    let s = initialMenuState(model);
    expect(s.focus).toBe(0);
    expect(stepMenu(layout, model, s, key('Enter')).result).toEqual({ kind: 'pick', id: 'a' });
    s = stepMenu(layout, model, s, key('ArrowDown')).state;
    expect(s.focus).toBe(2); // Beta is disabled
    s = stepMenu(layout, model, s, key('ArrowDown')).state;
    expect(s.focus).toBe(3);
    s = stepMenu(layout, model, s, key('ArrowDown')).state;
    expect(s.focus).toBe(0);
    s = stepMenu(layout, model, s, key('ArrowUp')).state;
    expect(s.focus).toBe(3);
    expect(stepMenu(layout, model, s, key('Enter')).result).toEqual({ kind: 'pick', id: 'cancel' });
  });

  it('picks by click and ignores disabled rows', () => {
    const click = (r: (typeof layout.rows)[number]) =>
      stepMenu(layout, model, initialMenuState(model), { type: 'click', ...centre(r) });
    expect(click(layout.rows[2]!).result).toEqual({ kind: 'pick', id: 'c' });
    expect(click(layout.rows[1]!).result).toEqual({ kind: 'none' });
    expect(click(layout.buttons[0]!).result).toEqual({ kind: 'pick', id: 'cancel' });
    const hover = stepMenu(layout, model, initialMenuState(model), { type: 'hover', ...centre(layout.rows[2]!) });
    expect(hover.state.focus).toBe(2);
    expect(stepMenu(layout, model, hover.state, { type: 'click', x: 0, y: 0 }).result).toEqual({ kind: 'none' });
  });

  it('starts on the first enabled entry', () => {
    const m: MenuModel = {
      ...model,
      rows: [
        { id: 'x', label: 'X', enabled: false },
        { id: 'y', label: 'Y' },
      ],
    };
    expect(initialMenuState(m).focus).toBe(1);
  });
});
