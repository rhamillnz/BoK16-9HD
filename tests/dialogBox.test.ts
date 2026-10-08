import { describe, expect, it } from 'vitest';
import type { Font, Glyph } from '../src/formats/fnt';
import {
  choiceAt,
  initialState,
  layoutDialog,
  paginate,
  rasterizeText,
  splitParagraphs,
  step,
  wrapParagraph,
  wrapText,
  type BoxLayoutOptions,
} from '../src/ui/dialogBox';

/** Fixed-width 4x6 font covering codes 32..126; every glyph is a solid block. */
function testFont(): Font {
  const glyphs: Glyph[] = [];
  for (let code = 32; code < 127; code++) {
    glyphs.push({ code, width: 4, height: 6, pixels: new Uint8Array(24).fill(code === 32 ? 0 : 1) });
  }
  return { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };
}

const font = testFont();
const opts: BoxLayoutOptions = { scale: 2, box: { x: 10, y: 20, width: 200, height: 100 }, padding: 4 };

describe('wrapping', () => {
  it('splits paragraphs on newlines', () => {
    expect(splitParagraphs('One\nTwo\nThree\n\n')).toEqual(['One', 'Two', 'Three']);
  });
  it('wraps greedily at word boundaries', () => {
    // 4px glyphs: 20px = 5 chars per line.
    expect(wrapParagraph(font, 'ab cd ef', 20)).toEqual(['ab cd', 'ef']);
  });
  it('breaks words longer than a line', () => {
    expect(wrapParagraph(font, 'abcdefghij', 20)).toEqual(['abcde', 'fghij']);
  });
  it('marks paragraph starts', () => {
    const lines = wrapText(font, 'ab\ncd', 100);
    expect(lines.map((l) => [l.text, l.blankBefore])).toEqual([
      ['ab', false],
      ['cd', true],
    ]);
  });
  it('never wraps control codes into line text', () => {
    const lines = wrapText(font, '\xf3ab \xf0cd #ef#', 100);
    expect(lines.map((l) => l.text)).toEqual(['ab cd ef']);
    expect(lines[0]!.runs!.map((r) => [r.text, r.style.italic, r.style.emphasis, r.style.bold])).toEqual([
      ['ab', true, false, false],
      [' cd', false, true, false],
      [' ef', false, false, true],
    ]);
  });
});

describe('pagination', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `l${i}`, blankBefore: false }));
  it('splits into pages of N rows', () => {
    const pages = paginate(mk(5), 2);
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
  });
  it('counts paragraph gaps and drops them at a page top', () => {
    const lines = [
      { text: 'a', blankBefore: false },
      { text: 'b', blankBefore: true },
      { text: 'c', blankBefore: false },
    ];
    const pages = paginate(lines, 2);
    expect(pages).toEqual([[lines[0]], [{ text: 'b', blankBefore: false }, lines[2]]]);
  });
});

describe('layout and input', () => {
  const snippet = { text: 'ab cd ef gh', displayStyle3: 0 };
  it('lays choices in a grid inside the box and hit-tests them', () => {
    const layout = layoutDialog(font, snippet, ['Yes', 'No', 'Maybe', 'Later'], opts);
    expect(layout.choices).toHaveLength(4);
    for (const c of layout.choices) {
      expect(c.rect.x).toBeGreaterThanOrEqual(opts.box.x);
      expect(c.rect.y + c.rect.height).toBeLessThanOrEqual(opts.box.y + opts.box.height);
      expect(choiceAt(layout, c.rect.x + 1, c.rect.y + 1)).toBe(c.index);
    }
    expect(choiceAt(layout, 0, 0)).toBe(-1);
  });
  it('lays query snippets in one row', () => {
    const layout = layoutDialog(font, { text: 'Ok?', displayStyle3: 0x2 }, ['Yes', 'No'], opts);
    expect(layout.choices[0]!.rect.y).toBe(layout.choices[1]!.rect.y);
  });
  it('selects by keyboard and mouse', () => {
    const layout = layoutDialog(font, { text: 'Hi', displayStyle3: 0x4 }, ['A', 'B', 'C'], opts);
    let s = initialState(layout);
    expect(s.selected).toBe(0);
    s = step(layout, s, { type: 'key', key: 'ArrowRight' }).state;
    expect(s.selected).toBe(1);
    expect(step(layout, s, { type: 'key', key: 'Enter' }).result).toEqual({ kind: 'choose', index: 1 });
    expect(step(layout, s, { type: 'key', key: '3' }).result).toEqual({ kind: 'choose', index: 2 });
    const r = layout.choices[0]!.rect;
    expect(step(layout, s, { type: 'click', x: r.x + 1, y: r.y + 1 }).result).toEqual({ kind: 'choose', index: 0 });
    expect(step(layout, s, { type: 'hover', x: r.x + 1, y: r.y + 1 }).state.selected).toBe(0);
  });
  it('pages long text before showing choices, and finishes choice-less snippets', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const layout = layoutDialog(font, { text: long, displayStyle3: 0 }, ['Go'], opts);
    expect(layout.pages.length).toBeGreaterThan(1);
    let s = initialState(layout);
    expect(step(layout, s, { type: 'click', x: 0, y: 0 }).state.page).toBe(1);
    for (let i = 0; i < layout.pages.length - 1; i++) s = step(layout, s, { type: 'key', key: ' ' }).state;
    expect(s.page).toBe(layout.pages.length - 1);
    expect(step(layout, s, { type: 'key', key: 'Enter' }).result).toEqual({ kind: 'choose', index: 0 });

    const plain = layoutDialog(font, { text: 'Bye', displayStyle3: 0 }, [], opts);
    expect(step(plain, initialState(plain), { type: 'key', key: 'Enter' }).result).toEqual({ kind: 'finish' });
  });
});

describe('rasterizeText', () => {
  it('scales glyph pixels by an integer factor', () => {
    const img = rasterizeText(font, 'a ', 3, [1, 2, 3, 255]);
    expect(img.width).toBe(8 * 3);
    expect(img.height).toBe(6 * 3);
    expect(Array.from(img.data.slice(0, 4))).toEqual([1, 2, 3, 255]);
    // second glyph (space) is transparent
    expect(img.data[4 * 3 * 4 + 3]).toBe(0);
  });
});
