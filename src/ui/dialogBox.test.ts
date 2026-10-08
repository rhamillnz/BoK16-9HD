import { describe, expect, it } from 'vitest';
import type { Font, Glyph } from '../formats/fnt';
import { layoutDialog, type BoxLayoutOptions } from './dialogBox';

function testFont(): Font {
  const glyphs: Glyph[] = [];
  for (let code = 32; code < 127; code++) {
    glyphs.push({ code, width: 4, height: 6, pixels: new Uint8Array(24).fill(code === 32 ? 0 : 1) });
  }
  return { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };
}

const font = testFont();
const opts: BoxLayoutOptions = { scale: 2, box: { x: 100, y: 300, width: 200, height: 100 }, padding: 4 };
const snippet = { text: 'Hello there', displayStyle3: 0 };

describe('layoutDialog with a speaker', () => {
  it('lays out exactly as before without a speaker', () => {
    const l = layoutDialog(font, snippet, [], opts);
    expect(l.title).toBeUndefined();
    expect(l.portrait).toBeUndefined();
    expect(l.textArea.y).toBe(opts.box.y + opts.padding);
  });

  it('titles the box with the centred name and moves the text below it', () => {
    const plain = layoutDialog(font, snippet, [], opts);
    const l = layoutDialog(font, snippet, [], opts, { name: 'Gorath' });
    const t = l.title!;
    expect(t.text).toBe('Gorath');
    expect(t.y).toBe(opts.box.y + opts.padding);
    // 6 chars * 4px + 1px bold = 25 font px = 50 canvas px, centred in 200.
    expect(t.x).toBe(100 + 75);
    expect(l.textArea.y).toBeGreaterThan(t.y + font.height * 2);
    expect(l.rowsPerPage).toBeLessThan(plain.rowsPerPage);
  });

  it('stands the portrait centred just above the box at the box scale', () => {
    const l = layoutDialog(
      font,
      snippet,
      [],
      { ...opts, box: { ...opts.box, y: 600 } },
      {
        name: 'Gorath',
        portrait: { width: 50, height: 60 },
      },
    );
    const p = l.portrait!;
    expect(p.width).toBe(100);
    expect(p.height).toBe(120);
    expect(p.x).toBe(100 + (200 - 100) / 2);
    expect(p.y + p.height).toBeLessThan(600);
    expect(p.y + p.height).toBeGreaterThan(590);
  });

  it('shrinks a portrait that would not fit above the box', () => {
    const l = layoutDialog(font, snippet, [], opts, { name: 'Big', portrait: { width: 100, height: 200 } });
    expect(l.portrait!.height).toBeLessThanOrEqual(opts.box.y);
    expect(l.portrait!.y).toBeGreaterThanOrEqual(0);
  });

  it('shows the name when there is no portrait', () => {
    const l = layoutDialog(font, snippet, [], opts, { name: 'Nobody' });
    expect(l.title).toBeDefined();
    expect(l.portrait).toBeUndefined();
  });
});
