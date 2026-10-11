import { parseBMX, type IndexedImage } from '../formats/bmx';
import { parsePalette, type Palette } from '../formats/palette';
import { parseSCX } from '../formats/scx';
import type { TtmFrameOp } from '../formats/ttm';
import type { ReadResource } from './encounterDriver';
import { HD_SCALE, hdScreenName, hdSpriteName } from './cutsceneHd';

const W = 320;
const H = 200;
const S = HD_SCALE;
/** Layer numbers as in CutsceneRenderer: 0 flip, 1 screen, 2 background, 3 save. */
const LAYER_SCREEN = 1;
const LAYER_BACKGROUND = 2;
const LAYER_COUNT = 4;
/** Canvases handed out by `draw`: a frame is built, then shown, before the next but one is built. */
const OUTPUTS = 3;

export type HdPicture = CanvasImageSource & { width: number; height: number };

type Canvas = HTMLCanvasElement;
type Ctx = CanvasRenderingContext2D;

const makeCanvas = (w: number, h: number): Canvas => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/**
 * The cutscene renderer at 4x: runs the same TTM ops as CutsceneRenderer on 1280x800 canvases, drawing the
 * upscaled picture of each sprite and screen (cutsceneHd.ts) where there is one and the original pixels,
 * enlarged without smoothing, where there is not. Browser only (canvas).
 */
export class CutsceneHdRenderer {
  private readonly layers: Ctx[];
  private readonly outputs: Canvas[];
  private nextOutput = 0;
  private readonly palettes = new Map<number, { name: string; pal: Palette }>();
  private readonly images = new Map<number, { name: string; images: IndexedImage[] }>();
  private readonly lowRes = new Map<string, Canvas>();
  private readonly saved = new Map<number, { x: number; y: number; width: number; height: number; canvas: Canvas }>();
  private paletteSlot = 0;
  private imageSlot = 0;
  private saveLayer = 0;
  private clip: { x0: number; y0: number; x1: number; y1: number } | undefined;

  constructor(
    private readonly read: ReadResource,
    /** Upscaled pictures by file stem (`hdSpriteName` / `hdScreenName`). */
    private readonly hd: ReadonlyMap<string, HdPicture>,
  ) {
    this.layers = Array.from({ length: LAYER_COUNT }, () => {
      const ctx = makeCanvas(W * S, H * S).getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W * S, H * S);
      return ctx;
    });
    this.outputs = Array.from({ length: OUTPUTS }, () => makeCanvas(W * S, H * S));
  }

  /** Run one frame's ops and return the picture to show (a canvas kept until two more frames are drawn). */
  draw(ops: readonly TtmFrameOp[]): Canvas {
    for (const op of ops) this.run(op);
    const out = this.outputs[this.nextOutput]!;
    this.nextOutput = (this.nextOutput + 1) % OUTPUTS;
    const octx = out.getContext('2d')!;
    octx.drawImage(this.screen.canvas, 0, 0);
    this.copy(this.layers[LAYER_BACKGROUND]!, this.screen, 0, 0, W, H, false);
    return out;
  }

  private get screen(): Ctx {
    return this.layers[LAYER_SCREEN]!;
  }

  private layer(n: number): Ctx {
    return this.layers[n] ?? this.screen;
  }

  private run(op: TtmFrameOp): void {
    switch (op.op) {
      case 'slotImage':
        this.imageSlot = op.slot;
        break;
      case 'slotPalette':
        this.paletteSlot = op.slot;
        break;
      case 'loadPalette': {
        this.palettes.delete(this.paletteSlot);
        const bytes = this.read(op.name);
        try {
          if (bytes) this.palettes.set(this.paletteSlot, { name: op.name, pal: parsePalette(bytes) });
        } catch {
          /* palette stays unset */
        }
        break;
      }
      case 'loadImage': {
        this.images.delete(this.imageSlot);
        const bytes = this.read(op.name);
        try {
          if (bytes) this.images.set(this.imageSlot, { name: op.name, images: parseBMX(bytes) });
        } catch {
          /* slot stays empty */
        }
        break;
      }
      case 'loadScreen':
        this.loadScreen(op.name);
        break;
      case 'clip':
        this.clip = { x0: op.x, y0: op.y, x1: op.right, y1: op.bottom };
        break;
      case 'sprite':
        this.sprite(op);
        break;
      case 'spriteRotated':
        this.spriteRotated(op);
        break;
      case 'rect':
        this.rect(op);
        break;
      case 'saveBackground':
        this.copy(this.screen, this.layers[LAYER_BACKGROUND]!, 0, 0, W, H, false);
        break;
      case 'saveRect':
        this.copy(this.screen, this.layers[LAYER_BACKGROUND]!, op.x, op.y, op.width, op.height, false);
        break;
      case 'copyLayer':
        this.copy(this.layer(op.source), this.layer(op.target), op.x, op.y, op.width, op.height, false);
        break;
      case 'setSaveLayer':
        this.saveLayer = op.layer;
        break;
      case 'saveRegion': {
        if (op.width <= 0 || op.height <= 0) break;
        const canvas = makeCanvas(op.width * S, op.height * S);
        canvas
          .getContext('2d')!
          .drawImage(
            this.screen.canvas,
            op.x * S,
            op.y * S,
            op.width * S,
            op.height * S,
            0,
            0,
            op.width * S,
            op.height * S,
          );
        this.saved.set(this.saveLayer, { x: op.x, y: op.y, width: op.width, height: op.height, canvas });
        break;
      }
      case 'drawSavedRegion': {
        const r = this.saved.get(op.layer);
        if (r) this.clipped(this.screen, (ctx) => ctx.drawImage(r.canvas, r.x * S, r.y * S));
        break;
      }
      default:
        break; // timing, dialogue, sound and fade ops belong to the player
    }
  }

  /** Copy a rectangle (scene pixels) between layers; `clipped` applies the clip region. */
  private copy(from: Ctx, to: Ctx, x: number, y: number, w: number, h: number, clipped: boolean): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(W, x + w);
    const y1 = Math.min(H, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    const go = (ctx: Ctx) =>
      ctx.drawImage(
        from.canvas,
        x0 * S,
        y0 * S,
        (x1 - x0) * S,
        (y1 - y0) * S,
        x0 * S,
        y0 * S,
        (x1 - x0) * S,
        (y1 - y0) * S,
      );
    if (clipped) this.clipped(to, go);
    else go(to);
  }

  /** Draw within the clip region (inclusive bounds, in scene pixels) and the screen. */
  private clipped(ctx: Ctx, f: (ctx: Ctx) => void): void {
    ctx.save();
    ctx.beginPath();
    const c = this.clip;
    if (c) ctx.rect(c.x0 * S, c.y0 * S, (c.x1 - c.x0 + 1) * S, (c.y1 - c.y0 + 1) * S);
    else ctx.rect(0, 0, W * S, H * S);
    ctx.clip();
    f(ctx);
    ctx.restore();
  }

  /** The picture for a stem: the upscaled one, or the original pixels as a small canvas (drawn unsmoothed). */
  private picture(stem: string, make: () => Canvas | undefined): { image: HdPicture; hd: boolean } | undefined {
    const hd = this.hd.get(stem);
    if (hd) return { image: hd, hd: true };
    let low = this.lowRes.get(stem);
    if (!low) {
      low = make();
      if (!low) return undefined;
      this.lowRes.set(stem, low);
    }
    return { image: low, hd: false };
  }

  private loadScreen(name: string): void {
    const pal = this.palettes.get(this.paletteSlot);
    const bytes = this.read(name);
    if (!pal || !bytes) return;
    let img: IndexedImage;
    try {
      img = parseSCX(bytes);
    } catch {
      return;
    }
    const pic = this.picture(hdScreenName(name, pal.name), () => toCanvas(img, pal.pal, false));
    if (!pic) return;
    const ctx = this.screen;
    ctx.save();
    ctx.imageSmoothingEnabled = pic.hd;
    ctx.drawImage(pic.image, 0, 0, img.width * S, img.height * S);
    ctx.restore();
    this.copy(this.screen, this.layers[LAYER_BACKGROUND]!, 0, 0, W, H, false);
  }

  private spritePicture(slot: number, index: number) {
    const set = this.images.get(slot);
    const pal = this.palettes.get(this.paletteSlot);
    const img = set?.images[index];
    if (!set || !pal || !img || img.width === 0 || img.height === 0) return undefined;
    const pic = this.picture(hdSpriteName(set.name, index, pal.name), () => toCanvas(img, pal.pal, true));
    return pic && { ...pic, img };
  }

  private sprite(op: Extract<TtmFrameOp, { op: 'sprite' }>): void {
    const p = this.spritePicture(op.slot, op.index);
    if (!p) return;
    let w = p.img.width;
    let h = p.img.height;
    let flipX = op.flipX;
    let flipY = op.flipY;
    if (op.width !== 0) {
      w = Math.abs(op.width);
      h = Math.abs(op.height);
      if (op.width < 0) flipX = !flipX;
      if (op.height < 0) flipY = !flipY;
    }
    this.clipped(this.screen, (ctx) => {
      ctx.imageSmoothingEnabled = p.hd;
      ctx.translate((op.x + (flipX ? w : 0)) * S, (op.y + (flipY ? h : 0)) * S);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(p.image, 0, 0, w * S, h * S);
    });
  }

  private spriteRotated(op: Extract<TtmFrameOp, { op: 'spriteRotated' }>): void {
    const p = this.spritePicture(op.slot, op.index);
    const w = Math.abs(op.width);
    const h = Math.abs(op.height);
    if (!p || w === 0 || h === 0) return;
    this.clipped(this.screen, (ctx) => {
      ctx.imageSmoothingEnabled = p.hd;
      ctx.translate(op.x * S, op.y * S);
      ctx.rotate((op.angle * Math.PI) / 180);
      ctx.drawImage(p.image, (-w / 2) * S, (-h / 2) * S, w * S, h * S);
    });
  }

  private rect(op: Extract<TtmFrameOp, { op: 'rect' }>): void {
    const pal = this.palettes.get(this.paletteSlot)?.pal;
    if (!pal || op.width <= 0 || op.height <= 0) return;
    const css = (i: number) => `rgb(${pal[i * 4]},${pal[i * 4 + 1]},${pal[i * 4 + 2]})`;
    this.clipped(this.screen, (ctx) => {
      if (op.filled) {
        ctx.fillStyle = css(op.fill);
        ctx.fillRect(op.x * S, op.y * S, op.width * S, op.height * S);
      }
      ctx.strokeStyle = css(op.edge);
      ctx.lineWidth = S;
      ctx.strokeRect((op.x + 0.5) * S, (op.y + 0.5) * S, (op.width - 1) * S, (op.height - 1) * S);
    });
  }
}

/** An indexed image as an RGBA canvas; with `transparentZero` index 0 is see-through (sprites). */
function toCanvas(img: IndexedImage, pal: Palette, transparentZero: boolean): Canvas {
  const c = makeCanvas(img.width, img.height);
  const data = new ImageData(img.width, img.height);
  for (let i = 0; i < img.pixels.length; i++) {
    const k = img.pixels[i]!;
    data.data[i * 4] = pal[k * 4]!;
    data.data[i * 4 + 1] = pal[k * 4 + 1]!;
    data.data[i * 4 + 2] = pal[k * 4 + 2]!;
    data.data[i * 4 + 3] = transparentZero && k === 0 ? 0 : 255;
  }
  c.getContext('2d')!.putImageData(data, 0, 0);
  return c;
}
