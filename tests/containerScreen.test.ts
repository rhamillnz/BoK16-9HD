import { describe, expect, it } from 'vitest';
import {
  initialContainerState,
  layoutContainerScreen,
  layoutWordLock,
  stepContainerScreen,
  stepWordLock,
  defaultContainerLayoutOptions,
} from '../src/ui/containerScreen';

const layout = layoutContainerScreen(defaultContainerLayoutOptions(3, 5, 8));
const centre = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe('container screen', () => {
  it('lays out every slot inside the panel without overlap', () => {
    expect(layout.containerSlots).toHaveLength(5);
    expect(layout.characterSlots).toHaveLength(8);
    expect(layout.tabs).toHaveLength(3);
    const all = [...layout.containerSlots, ...layout.characterSlots].map((s) => s.rect);
    for (const r of all) {
      expect(r.x).toBeGreaterThanOrEqual(layout.panel.x);
      expect(r.x + r.width).toBeLessThanOrEqual(layout.panel.x + layout.panel.width);
      expect(r.y + r.height).toBeLessThanOrEqual(layout.panel.y + layout.panel.height);
    }
    const [a, b] = layout.containerSlots;
    expect(a!.rect.x + a!.rect.width).toBeLessThanOrEqual(b!.rect.x);
    const left = Math.max(...layout.containerSlots.map((s) => s.rect.x + s.rect.width));
    expect(left).toBeLessThan(layout.tabs[0]!.rect.x);
  });

  it('click on a container slot takes, on a character slot puts, on buttons acts', () => {
    const s = initialContainerState();
    const c = centre(layout.containerSlots[2]!.rect);
    expect(stepContainerScreen(layout, s, { type: 'click', ...c }).action).toEqual({ kind: 'take', slot: 2 });
    const p = centre(layout.characterSlots[4]!.rect);
    expect(stepContainerScreen(layout, s, { type: 'click', ...p }).action).toEqual({ kind: 'put', tab: 0, slot: 4 });
    expect(stepContainerScreen(layout, s, { type: 'click', ...centre(layout.takeAll) }).action).toEqual({
      kind: 'takeAll',
    });
    expect(stepContainerScreen(layout, s, { type: 'click', ...centre(layout.close) }).action).toEqual({
      kind: 'close',
    });
    expect(stepContainerScreen(layout, s, { type: 'click', x: 0, y: 0 }).action).toEqual({ kind: 'none' });
  });

  it('switches character with tabs and Q/E, and puts from the chosen character', () => {
    let s = initialContainerState();
    s = stepContainerScreen(layout, s, { type: 'click', ...centre(layout.tabs[2]!.rect) }).state;
    expect(s.tab).toBe(2);
    expect(stepContainerScreen(layout, s, { type: 'click', ...centre(layout.characterSlots[0]!.rect) }).action).toEqual(
      { kind: 'put', tab: 2, slot: 0 },
    );
    s = stepContainerScreen(layout, s, { type: 'key', key: 'e' }).state;
    expect(s.tab).toBe(0);
    s = stepContainerScreen(layout, s, { type: 'key', key: 'Q' }).state;
    expect(s.tab).toBe(2);
    expect(stepContainerScreen(layout, s, { type: 'key', key: 't' }).action).toEqual({ kind: 'takeAll' });
  });

  it('hover tracks the slot under the pointer', () => {
    const r = stepContainerScreen(layout, initialContainerState(), {
      type: 'hover',
      ...centre(layout.characterSlots[1]!.rect),
    });
    expect(r.state.hover).toEqual({ side: 'party', slot: 1 });
    expect(stepContainerScreen(layout, r.state, { type: 'hover', x: 1, y: 1 }).state.hover).toBeUndefined();
  });
});

describe('word-lock screen', () => {
  const wl = layoutWordLock(5);

  it('places one box per tumbler, in a row inside the panel', () => {
    expect(wl.tumblers).toHaveLength(5);
    for (let i = 1; i < 5; i++)
      expect(wl.tumblers[i]!.rect.x).toBeGreaterThan(wl.tumblers[i - 1]!.rect.x + wl.tumblers[i - 1]!.rect.width - 1);
    expect(wl.tumblers[0]!.rect.x).toBeGreaterThan(wl.panel.x);
    const last = wl.tumblers[4]!.rect;
    expect(last.x + last.width).toBeLessThan(wl.panel.x + wl.panel.width);
  });

  it('clicking a tumbler or pressing its number turns it; the button gives up', () => {
    expect(stepWordLock(wl, { type: 'click', ...centre(wl.tumblers[3]!.rect) }, 5)).toEqual({
      kind: 'turn',
      tumbler: 3,
    });
    expect(stepWordLock(wl, { type: 'key', key: '1' }, 5)).toEqual({ kind: 'turn', tumbler: 0 });
    expect(stepWordLock(wl, { type: 'key', key: '6' }, 5)).toEqual({ kind: 'none' });
    expect(stepWordLock(wl, { type: 'click', ...centre(wl.leave) }, 5)).toEqual({ kind: 'leave' });
    expect(stepWordLock(wl, { type: 'hover', x: 0, y: 0 }, 5)).toEqual({ kind: 'none' });
  });
});
