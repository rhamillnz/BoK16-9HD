import { describe, expect, it } from 'vitest';
import type { Font } from '../src/formats/fnt';
import { defaultBoxOptions, drawDialog, initialState, layoutDialog } from '../src/ui/dialogBox';

/** A 3x2 font where every glyph is "# #" over "###". */
const glyph = (code: number) => ({ code, width: 3, height: 2, pixels: new Uint8Array([1, 0, 1, 1, 1, 1]) });
const font: Font = {
  version: 0xff,
  maxWidth: 3,
  height: 2,
  baseline: 1,
  firstChar: 32,
  glyphs: Array.from({ length: 96 }, (_, i) => glyph(32 + i)),
};

describe('drawDialog', () => {
  it('draws glyphs as rectangles and never overwrites the box with putImageData', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) =>
        k === 'fillRect' || k === 'strokeRect' || k === 'putImageData'
          ? (...a: number[]) => void calls.push(`${k}:${a.join(',')}`)
          : t[k],
      set: (t, k: string, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    const opts = { ...defaultBoxOptions(640, 360), scale: 1 };
    const layout = layoutDialog(font, { text: 'Hi', displayStyle3: 0 }, [], opts);
    drawDialog(ctx, font, layout, initialState(layout));
    expect(calls.some((c) => c.startsWith('putImageData'))).toBe(false);
    // box background, then per glyph row runs: "# #" is two 1px runs, "###" one 3px run
    const rects = calls.filter((c) => c.startsWith('fillRect')).slice(1);
    expect(rects).toHaveLength(2 * (2 + 1));
    expect(rects.some((c) => c.endsWith(',3,1'))).toBe(true);
  });
});
