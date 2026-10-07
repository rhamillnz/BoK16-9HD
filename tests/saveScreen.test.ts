import { describe, expect, it } from 'vitest';
import type { Font, Glyph } from '../src/formats/fnt';
import type { GamSave } from '../src/formats/gam';
import type { SlotInfo } from '../src/game/saveGame';
import { HudScreens } from '../src/ui/hud';
import { describeSlot, initialSaveScreenState, layoutSaveScreen, slotLabel, stepSaveScreen } from '../src/ui/saveScreen';

const slots: SlotInfo[] = [
  { slot: 'quick', summary: { savedAt: Date.UTC(2026, 0, 2, 3, 4), zone: 2, gameTime: 'day 5 12:30', gold: 40, members: ['Owyn', 'Pug'] } },
  { slot: 'slot1' },
  { slot: 'slot2', corrupt: true },
];
const layout = layoutSaveScreen(slots.length);
const key = (key: string) => ({ type: 'key', key }) as const;
const centre = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

describe('save screen', () => {
  it('fits on the HUD and lays out one row per slot', () => {
    expect(layout.rows).toHaveLength(3);
    expect(layout.panel.x).toBeGreaterThanOrEqual(0);
    expect(layout.panel.y + layout.panel.height).toBeLessThanOrEqual(1440);
    const last = layout.rows[2]!.rect;
    expect(last.y + last.height).toBeLessThan(layout.status.y);
  });

  it('saves into any slot and loads only from filled ones', () => {
    let s = initialSaveScreenState('save');
    expect(stepSaveScreen(layout, s, slots, key('Enter')).result).toEqual({ kind: 'save', slot: 'quick' });
    s = stepSaveScreen(layout, s, slots, key('ArrowDown')).state;
    expect(stepSaveScreen(layout, s, slots, key('Enter')).result).toEqual({ kind: 'save', slot: 'slot1' });

    s = stepSaveScreen(layout, s, slots, key('l')).state;
    expect(s.mode).toBe('load');
    const empty = stepSaveScreen(layout, s, slots, key('Enter'));
    expect(empty.result.kind).toBe('none');
    expect(empty.state.message).toBe('Slot is empty');
    s = stepSaveScreen(layout, s, slots, key('ArrowDown')).state;
    expect(stepSaveScreen(layout, s, slots, key('Enter')).state.message).toMatch(/cannot be read/);
    s = stepSaveScreen(layout, s, slots, key('ArrowDown')).state;
    expect(s.selected).toBe(0);
    expect(stepSaveScreen(layout, s, slots, key('Enter')).result).toEqual({ kind: 'load', slot: 'quick' });
  });

  it('switches tabs and picks rows with the mouse, wrapping the selection', () => {
    let s = initialSaveScreenState('save');
    const loadTab = centre(layout.tabs[1]!.rect);
    s = stepSaveScreen(layout, s, slots, { type: 'click', ...loadTab }).state;
    expect(s.mode).toBe('load');
    const row = centre(layout.rows[0]!.rect);
    expect(stepSaveScreen(layout, s, slots, { type: 'click', ...row }).result).toEqual({ kind: 'load', slot: 'quick' });
    expect(stepSaveScreen(layout, initialSaveScreenState(), slots, key('ArrowUp')).state.selected).toBe(2);
    expect(stepSaveScreen(layout, s, slots, { type: 'hover', ...centre(layout.rows[1]!.rect) }).state.selected).toBe(1);
  });

  it('describes slots', () => {
    expect(slotLabel('slot4')).toBe('Slot 4');
    expect(slotLabel('quick')).toMatch(/Quick/);
    expect(describeSlot(slots[0]!)).toBe('Zone 2  day 5 12:30  Owyn, Pug  40 royals  [2026-01-02 03:04]');
    expect(describeSlot(slots[1]!)).toBe('(empty)');
    expect(describeSlot(slots[2]!)).toBe('(unreadable)');
  });
});

describe('HudScreens save screen', () => {
  const font: Font = {
    version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32,
    glyphs: Array.from({ length: 95 }, (_, i): Glyph => ({ code: 32 + i, width: 4, height: 6, pixels: new Uint8Array(24) })),
  };
  const save = { characters: [], activeCharacters: [] } as unknown as GamSave;

  it('opens with F6 once a handler is set, blocks movement, and loads then closes', async () => {
    const hud = new HudScreens({ font, save, items: [] });
    expect(hud.keyDown('F6', 'F6')).toBe(true);
    await Promise.resolve();
    expect(hud.screen).toBe('none');

    const calls: string[] = [];
    hud.saveHandler = {
      list: async () => slots,
      save: async (s) => { calls.push(`save ${s}`); return 'Saved'; },
      load: async (s) => { calls.push(`load ${s}`); return 'Loaded'; },
    };
    hud.keyDown('F6', 'F6');
    await new Promise((r) => setTimeout(r, 0));
    expect(hud.screen).toBe('saves');
    expect(hud.blocking).toBe(true);

    hud.keyDown('Enter', 'Enter');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['save quick']);
    expect(hud.screen).toBe('saves');

    hud.keyDown('KeyL', 'l');
    hud.keyDown('Enter', 'Enter');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['save quick', 'load quick']);
    expect(hud.screen).toBe('none');
  });

  it('shows a failure message and stays open when loading fails', async () => {
    const hud = new HudScreens({ font, save, items: [] });
    hud.saveHandler = { list: async () => slots, save: async () => 'x', load: async () => { throw new Error('boom'); } };
    await hud.openSaves('load');
    hud.keyDown('Enter', 'Enter');
    await new Promise((r) => setTimeout(r, 0));
    expect(hud.screen).toBe('saves');
  });
});
