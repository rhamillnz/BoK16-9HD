import { parseBMX, toRGBA } from '../formats/bmx';
import { parseBook } from '../formats/book';
import { parsePalette } from '../formats/palette';
import { parseSCX } from '../formats/scx';
import type { HudScreens } from '../ui/hud';
import type { BookScreenView } from '../ui/bookScreen';
import '../ui/bookScreen'; // registers the book screen
import type { FetchResources } from './townScene';

export interface BookPlayerHost {
  fetch: FetchResources;
  hud: HudScreens;
}

const toCanvas = (width: number, height: number, rgba: Uint8ClampedArray<ArrayBuffer>): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return c;
};

/**
 * Book chapters (`C11.BOK` and friends) for cutscenes and chapter transitions. The returned `playBook` shows the
 * book on the 'book' screen over BOOK.SCX with the pictures of BOOK.BMX; it resolves when the last page is turned
 * or Escape is pressed, and at once when the book cannot be read. Also runnable with `?book=C11.BOK`.
 */
export function installBookPlayer(host: BookPlayerHost): { playBook(file: string): Promise<void> } {
  const playBook = async (file: string): Promise<void> => {
    let view: BookScreenView;
    try {
      const read = await host.fetch([file, 'BOOK.SCX', 'BOOK.BMX', 'BOOK.PAL']);
      const bytes = read(file);
      if (!bytes) return;
      const book = parseBook(bytes);
      if (book.pages.length === 0) return;
      const palBytes = read('BOOK.PAL');
      const palette = palBytes ? parsePalette(palBytes) : undefined;
      let background: HTMLCanvasElement | undefined;
      const scx = read('BOOK.SCX');
      if (scx && palette) {
        try {
          const img = parseSCX(scx);
          const opaque = new Uint8Array(palette);
          for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
          background = toCanvas(img.width, img.height, toRGBA(img, opaque));
        } catch { /* plain paper instead */ }
      }
      const images: (HTMLCanvasElement | undefined)[] = [];
      const bmx = read('BOOK.BMX');
      if (bmx && palette) {
        try { for (const img of parseBMX(bmx)) images.push(toCanvas(img.width, img.height, toRGBA(img, palette))); } catch { /* no pictures */ }
      }
      view = { book, background, images, done: () => undefined };
    } catch (err) {
      console.warn('Book unavailable:', err);
      return;
    }
    await new Promise<void>((resolve) => {
      view.done = () => {
        host.hud.end('book');
        resolve();
      };
      host.hud.open('book', view);
    });
  };

  const q = new URLSearchParams(location.search).get('book');
  if (q) void playBook(q);
  return { playBook };
}
