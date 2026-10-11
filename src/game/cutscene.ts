import { parseBMX, type IndexedImage } from '../formats/bmx';
import { parsePalette, type Palette } from '../formats/palette';
import { parseSCX } from '../formats/scx';
import {
  parseAds,
  parseTtmFrames,
  type AdsAction,
  type AdsCondition,
  type AdsScene,
  type TtmFrame,
  type TtmFrameOp,
} from '../formats/ttm';
import type { ReadResource } from './encounterDriver';
import { SCENE_HEIGHT, SCENE_WIDTH, type FetchResources } from './townScene';

/**
 * The cutscene player for `.ADS`/`.TTM` animations (see docs/formats/cutscenes.md): an ADS decides which
 * scripts of a TTM run and when, the TTM frames are drawn onto 320x200 layers, and a small timing state
 * machine presents them with the original's delays, fades, text and click-to-continue pauses.
 * Everything here is pure and driven by `update(dtMs)`, so it is testable without a browser.
 */

// ---- Script runner ---------------------------------------------------------

interface RunningScript {
  tag: number;
  frame: number;
  running: boolean;
}

/**
 * Steps the scripts an ADS starts. Each `next()` returns one display frame: the ops of one frame from every
 * running script, in start order. An ADS block fires when all its conditions hold (script not started yet, or
 * finished, or the chapter bounds); only the `then` branch is used and only the first matching block of
 * the file fires per step.
 */
export class CutsceneRunner {
  private readonly started = new Set<number>();
  private readonly finished = new Set<number>();
  private running: RunningScript[] = [];

  constructor(
    private readonly ads: readonly AdsScene[],
    private readonly frames: readonly TtmFrame[],
    private readonly chapter = 1,
  ) {}

  /** The ops of the next display frame, or undefined when nothing runs any more. */
  next(): TtmFrameOp[] | undefined {
    for (;;) {
      this.evaluate();
      if (this.running.length === 0) return undefined;
      const ops: TtmFrameOp[] = [];
      let stepped = false;
      for (const script of this.running) stepped = this.step(script, ops) || stepped;
      for (const script of this.running) if (!script.running) this.finished.add(script.tag);
      this.running = this.running.filter((s) => s.running);
      if (stepped) return ops;
    }
  }

  private step(script: RunningScript, out: TtmFrameOp[]): boolean {
    const frame = this.frames[script.frame];
    if (!frame) {
      script.running = false;
      return false;
    }
    let end = false;
    let goto: number | undefined;
    for (const op of frame.ops) {
      if (op.op === 'endScript') end = true;
      else if (op.op === 'gotoTag') goto = op.tag;
      out.push(op);
    }
    if (end) {
      script.running = false;
    } else if (goto !== undefined) {
      const target = this.frameWithTag(goto);
      if (target === undefined) script.running = false;
      else script.frame = target;
    } else {
      script.frame++;
    }
    return true;
  }

  private evaluate(): void {
    for (const scene of this.ads) {
      for (const block of scene.blocks) {
        if (!block.conditions.every((c) => this.holds(c))) continue;
        for (const action of block.then) this.apply(action);
        return;
      }
    }
  }

  private holds(c: AdsCondition): boolean {
    switch (c.kind) {
      case 'notStarted':
        return !this.started.has(c.script);
      case 'finished':
        return this.finished.has(c.script);
      case 'chapterGte':
        return this.chapter >= c.chapter;
      case 'chapterLte':
        return this.chapter <= c.chapter;
    }
  }

  private apply(a: AdsAction): void {
    if (a.kind === 'stop') {
      this.running = this.running.filter((s) => s.tag !== a.script);
      return;
    }
    this.started.add(a.script);
    const frame = this.frameWithTag(a.script);
    if (frame === undefined || this.running.some((s) => s.tag === a.script)) return;
    this.running.push({ tag: a.script, frame, running: true });
  }

  private frameWithTag(tag: number): number | undefined {
    const i = this.frames.findIndex((f) => f.tag === tag);
    return i < 0 ? undefined : i;
  }
}

// ---- Renderer --------------------------------------------------------------

/** Layer numbers used by `copyLayer` (0 flip, 1 screen, 2 background, 3 save); the screen is what is shown, the background is restored to it each frame. */
const LAYER_SCREEN = 1;
const LAYER_BACKGROUND = 2;
const LAYER_COUNT = 4;

const PIXELS = SCENE_WIDTH * SCENE_HEIGHT;

const newLayer = (): Uint8ClampedArray<ArrayBuffer> => {
  const layer = new Uint8ClampedArray(PIXELS * 4);
  for (let i = 3; i < layer.length; i += 4) layer[i] = 255;
  return layer;
};

interface SavedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/**
 * Draws TTM frame ops onto 320x200 RGBA layers. Image and palette slots, saved regions and the clip
 * region persist across frames, as in the original. Missing or undecodable resources are skipped.
 */
export class CutsceneRenderer {
  private readonly layers = Array.from({ length: LAYER_COUNT }, newLayer);
  private readonly palettes = new Map<number, Palette>();
  private readonly images = new Map<number, IndexedImage[]>();
  private readonly saved = new Map<number, SavedRegion>();
  private paletteSlot = 0;
  private imageSlot = 0;
  private saveLayer = 0;
  private clip: { x0: number; y0: number; x1: number; y1: number } | undefined;

  constructor(private readonly read: ReadResource) {}

  /** The colour of a palette entry in the current palette slot (black when there is none). */
  paletteColor(index: number): [number, number, number] {
    const pal = this.palettes.get(this.paletteSlot);
    return pal ? [pal[index * 4]!, pal[index * 4 + 1]!, pal[index * 4 + 2]!] : [0, 0, 0];
  }

  /** Run one frame's ops and return the picture to show (a copy). The screen is then reset to the background. */
  draw(ops: readonly TtmFrameOp[]): Uint8ClampedArray<ArrayBuffer> {
    for (const op of ops) this.run(op);
    const shown = new Uint8ClampedArray(this.layers[LAYER_SCREEN]!);
    this.layers[LAYER_SCREEN]!.set(this.layers[LAYER_BACKGROUND]!);
    return shown;
  }

  private layer(n: number): Uint8ClampedArray {
    return this.layers[n] ?? this.layers[LAYER_SCREEN]!;
  }

  private run(op: TtmFrameOp): void {
    const screen = this.layers[LAYER_SCREEN]!;
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
          if (bytes) this.palettes.set(this.paletteSlot, parsePalette(bytes));
        } catch {
          /* palette stays unset */
        }
        break;
      }
      case 'loadImage': {
        this.images.delete(this.imageSlot);
        const bytes = this.read(op.name);
        try {
          if (bytes) this.images.set(this.imageSlot, parseBMX(bytes));
        } catch {
          /* slot stays empty */
        }
        break;
      }
      case 'loadScreen': {
        const pal = this.palettes.get(this.paletteSlot);
        const bytes = this.read(op.name);
        if (!pal || !bytes) break;
        try {
          const picture = parseSCX(bytes);
          const noClip = this.clip;
          this.clip = undefined;
          for (let y = 0; y < Math.min(SCENE_HEIGHT, picture.height); y++) {
            for (let x = 0; x < Math.min(SCENE_WIDTH, picture.width); x++)
              this.put(screen, x, y, pal, picture.pixels[y * picture.width + x]!);
          }
          this.clip = noClip;
          this.layers[LAYER_BACKGROUND]!.set(screen);
        } catch {
          /* an undecodable screen leaves the picture as it was */
        }
        break;
      }
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
        this.layers[LAYER_BACKGROUND]!.set(screen);
        break;
      case 'saveRect':
        this.copyRect(op.x, op.y, op.width, op.height, screen, this.layers[LAYER_BACKGROUND]!);
        break;
      case 'copyLayer':
        this.copyRect(op.x, op.y, op.width, op.height, this.layer(op.source), this.layer(op.target));
        break;
      case 'setSaveLayer':
        this.saveLayer = op.layer;
        break;
      case 'saveRegion': {
        const rgba = new Uint8ClampedArray(Math.max(0, op.width) * Math.max(0, op.height) * 4);
        for (let y = 0; y < op.height; y++) {
          for (let x = 0; x < op.width; x++) {
            const sx = op.x + x;
            const sy = op.y + y;
            if (sx < 0 || sy < 0 || sx >= SCENE_WIDTH || sy >= SCENE_HEIGHT) continue;
            rgba.set(
              screen.subarray((sy * SCENE_WIDTH + sx) * 4, (sy * SCENE_WIDTH + sx) * 4 + 4),
              (y * op.width + x) * 4,
            );
          }
        }
        this.saved.set(this.saveLayer, { x: op.x, y: op.y, width: op.width, height: op.height, rgba });
        break;
      }
      case 'drawSavedRegion': {
        const region = this.saved.get(op.layer);
        if (!region) break;
        for (let y = 0; y < region.height; y++) {
          for (let x = 0; x < region.width; x++) {
            const o = (y * region.width + x) * 4;
            this.putRgba(screen, region.x + x, region.y + y, region.rgba[o]!, region.rgba[o + 1]!, region.rgba[o + 2]!);
          }
        }
        break;
      }
      default:
        break; // timing, dialogue, sound and fade ops belong to the player
    }
  }

  private inClip(x: number, y: number): boolean {
    const c = this.clip;
    if (x < 0 || y < 0 || x >= SCENE_WIDTH || y >= SCENE_HEIGHT) return false;
    return !c || (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);
  }

  private putRgba(layer: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number): void {
    if (!this.inClip(x, y)) return;
    const o = (y * SCENE_WIDTH + x) * 4;
    layer[o] = r;
    layer[o + 1] = g;
    layer[o + 2] = b;
    layer[o + 3] = 255;
  }

  private put(layer: Uint8ClampedArray, x: number, y: number, pal: Palette, index: number): void {
    this.putRgba(layer, x, y, pal[index * 4]!, pal[index * 4 + 1]!, pal[index * 4 + 2]!);
  }

  private copyRect(
    x: number,
    y: number,
    width: number,
    height: number,
    from: Uint8ClampedArray,
    to: Uint8ClampedArray,
  ): void {
    for (let py = Math.max(0, y); py < Math.min(SCENE_HEIGHT, y + height); py++) {
      for (let px = Math.max(0, x); px < Math.min(SCENE_WIDTH, x + width); px++) {
        const o = (py * SCENE_WIDTH + px) * 4;
        to.set(from.subarray(o, o + 4), o);
      }
    }
  }

  private source(slot: number, index: number): IndexedImage | undefined {
    return this.images.get(slot)?.[index];
  }

  private sprite(op: Extract<TtmFrameOp, { op: 'sprite' }>): void {
    const img = this.source(op.slot, op.index);
    const pal = this.palettes.get(this.paletteSlot);
    if (!img || !pal || img.width === 0 || img.height === 0) return;
    const screen = this.layers[LAYER_SCREEN]!;
    let flipX = op.flipX;
    let flipY = op.flipY;
    let w = img.width;
    let h = img.height;
    if (op.width !== 0) {
      // A scaled draw samples the source across the target size; negative sizes mirror.
      w = op.width;
      h = op.height;
      if (w < 0) {
        w = -w;
        flipX = !flipX;
      }
      if (h < 0) {
        h = -h;
        flipY = !flipY;
      }
    }
    const scaled = op.width !== 0;
    const sample = (i: number, steps: number, max: number, flip: boolean) => {
      const from = flip ? max : 0;
      const to = flip ? 0 : max;
      return Math.min(max, Math.max(0, Math.floor(from + (steps > 0 ? ((to - from) / steps) * i : 0))));
    };
    for (let dy = 0; dy < h; dy++) {
      const sy = scaled ? sample(dy, h - 1, img.height - 1, flipY) : flipY ? img.height - 1 - dy : dy;
      for (let dx = 0; dx < w; dx++) {
        const sx = scaled ? sample(dx, w - 1, img.width - 1, flipX) : flipX ? img.width - 1 - dx : dx;
        const index = img.pixels[sy * img.width + sx]!;
        if (index !== 0) this.put(screen, op.x + dx, op.y + dy, pal, index);
      }
    }
  }

  /** Rotated sprite: centred on (x, y), `width` x `height` on screen, angle in degrees. */
  private spriteRotated(op: Extract<TtmFrameOp, { op: 'spriteRotated' }>): void {
    const img = this.source(op.slot, op.index);
    const pal = this.palettes.get(this.paletteSlot);
    const w = Math.abs(op.width);
    const h = Math.abs(op.height);
    if (!img || !pal || w === 0 || h === 0) return;
    const rad = (op.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const ox = op.x - (cos * w - sin * h) / 2;
    const oy = op.y - (sin * w + cos * h) / 2;
    const xs = [ox, ox + cos * w, ox + cos * w - sin * h, ox - sin * h];
    const ys = [oy, oy + sin * w, oy + sin * w + cos * h, oy + cos * h];
    const screen = this.layers[LAYER_SCREEN]!;
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        const dx = x + 0.5 - ox;
        const dy = y + 0.5 - oy;
        const u = (dx * cos + dy * sin) / w;
        const v = (dy * cos - dx * sin) / h;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        const index = img.pixels[Math.floor(v * img.height) * img.width + Math.floor(u * img.width)]!;
        if (index !== 0) this.put(screen, x, y, pal, index);
      }
    }
  }

  private rect(op: Extract<TtmFrameOp, { op: 'rect' }>): void {
    const pal = this.palettes.get(this.paletteSlot);
    if (!pal || op.width <= 0 || op.height <= 0) return;
    const screen = this.layers[LAYER_SCREEN]!;
    const right = op.x + op.width - 1;
    const bottom = op.y + op.height - 1;
    for (let y = op.y; y <= bottom; y++) {
      for (let x = op.x; x <= right; x++) {
        const edge = x === op.x || x === right || y === op.y || y === bottom;
        if (edge) this.put(screen, x, y, pal, op.edge);
        else if (op.filled) this.put(screen, x, y, pal, op.fill);
      }
    }
  }
}

// ---- Player ----------------------------------------------------------------

/** Seconds per `delay` tick in the original. */
export const SECONDS_PER_TICK = 0.017;
/** Fade durations by the fade op's duration index, in seconds. */
export const FADE_SECONDS = [0, 0.1, 0.4, 0.8, 1.6, 3.2, 6.4] as const;
/** Fades whose start colour is below this index cover the whole screen; others only the picture window. */
const FIRST_PICTURE_COLOR = 16;
const WINDOW = { x: 15, y: 11, width: 289, height: 101 };
const FULL = { x: 0, y: 0, width: SCENE_WIDTH, height: SCENE_HEIGHT };

export interface CutsceneFade {
  color: [number, number, number];
  /** 0 = invisible, 1 = solid. */
  alpha: number;
  region: { x: number; y: number; width: number; height: number };
}

export interface CutsceneHost {
  /** Text of a cutscene dialogue key (the key is the TTM's own number; the dialogue key is 0x186a00 + it). */
  text?(key: number): string | undefined;
  /** A sound effect, or a music track when `index` is 255 or more. */
  sound?(index: number): void;
  /** A book page chapter (dialogue type 2) is wanted; call `done` when it has been read. */
  book?(key: number, done: () => void): void;
  /** A full dialogue (type 5) is wanted; call `done` when it ends. */
  dialog?(key: number, done: () => void): void;
}

export interface CutsceneOptions {
  ads: readonly AdsScene[];
  frames: readonly TtmFrame[];
  read: ReadResource;
  chapter?: number;
  host?: CutsceneHost;
}

type Wait = 'none' | 'click' | 'external' | 'fade' | 'delay';

/** Plays one ADS/TTM cutscene. Call `update(dtMs)` each frame and `click()` for the player's click or key. */
export class CutscenePlayer {
  /** The picture to show now (RGBA, 320x200), or undefined before the first frame. */
  image: Uint8ClampedArray<ArrayBuffer> | undefined;
  fade: CutsceneFade = { color: [0, 0, 0], alpha: 0, region: FULL };
  text: string | undefined;
  finished = false;
  /** The picture, fade or text changed since it was last read (`take()` clears it). */
  dirty = true;

  private readonly runner: CutsceneRunner;
  private readonly renderer: CutsceneRenderer;
  private readonly host: CutsceneHost;
  private wait: Wait = 'none';
  private remaining = 0;
  private fadeAnim: { from: number; to: number; duration: number; elapsed: number } | undefined;
  private delayMs = 0;
  private dialogType = 0;
  private frame:
    | {
        ops: TtmFrameOp[];
        next: number;
        picture: Uint8ClampedArray<ArrayBuffer>;
        presented: boolean;
        scriptEnded: boolean;
      }
    | undefined;
  private onFinished: (() => void) | undefined;

  constructor(opts: CutsceneOptions) {
    this.runner = new CutsceneRunner(opts.ads, opts.frames, opts.chapter ?? 1);
    this.renderer = new CutsceneRenderer(opts.read);
    this.host = opts.host ?? {};
  }

  /** Begin playing; `onFinished` runs once when the last frame is done. */
  start(onFinished?: () => void): void {
    this.onFinished = onFinished;
    this.advance();
  }

  /** Clear and return the dirty flag. */
  take(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  get waitingForClick(): boolean {
    return this.wait === 'click';
  }

  /** Paused while a book or dialogue screen (see `CutsceneHost.book`) is shown on top. */
  get waitingForExternal(): boolean {
    return this.wait === 'external';
  }

  /** Move time forward. */
  update(dtMs: number): void {
    if (this.finished) return;
    if (this.wait === 'fade' && this.fadeAnim) {
      const a = this.fadeAnim;
      a.elapsed += dtMs / 1000;
      const t = a.duration > 0 ? Math.min(1, a.elapsed / a.duration) : 1;
      this.fade = { ...this.fade, alpha: a.from + (a.to - a.from) * t };
      this.dirty = true;
      if (t >= 1) {
        this.fadeAnim = undefined;
        this.wait = 'none';
        this.advance();
      }
    } else if (this.wait === 'delay') {
      this.remaining -= dtMs;
      if (this.remaining <= 0) {
        this.wait = 'none';
        this.advance();
      }
    }
  }

  /** The player clicked or pressed a key: continue past a text pause. Ignored while a delay or fade runs. */
  click(): void {
    if (this.wait !== 'click') return;
    this.wait = 'none';
    this.advance();
  }

  /** Stop at once (Escape), without playing the rest. */
  skip(): void {
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.wait = 'none';
    this.dirty = true;
    this.onFinished?.();
  }

  private present(): void {
    const f = this.frame;
    if (!f || f.presented) return;
    this.image = f.picture;
    f.presented = true;
    this.dirty = true;
  }

  private advance(): void {
    if (this.finished || this.wait !== 'none') return;
    if (!this.frame) {
      const ops = this.runner.next();
      if (!ops) return this.finish();
      this.frame = { ops, next: 0, picture: this.renderer.draw(ops), presented: false, scriptEnded: false };
      this.fade = { ...this.fade, alpha: 0 };
    }
    const f = this.frame;
    while (f.next < f.ops.length) {
      const op = f.ops[f.next++]!;
      switch (op.op) {
        case 'delay':
          this.delayMs = op.ticks * SECONDS_PER_TICK * 1000;
          break;
        case 'sound':
          this.host.sound?.(op.index);
          break;
        case 'endScript':
          f.scriptEnded = true;
          break;
        case 'dialog':
          if (this.showDialog(op.key, op.type)) return;
          break;
        case 'fadeIn':
        case 'fadeOut':
          if (this.startFade(op)) return;
          break;
        default:
          break;
      }
    }
    this.present();
    if (!f.scriptEnded) this.fade = { ...this.fade, alpha: 0 };
    if (this.dialogType === 1 || this.dialogType === 4) this.setText(undefined);
    this.frame = undefined;
    this.wait = 'delay';
    this.remaining = this.delayMs;
    this.dirty = true;
  }

  private setText(text: string | undefined): void {
    if (this.text === text) return;
    this.text = text;
    this.dirty = true;
  }

  /** Returns true when the player must wait (for a click or an external screen). */
  private showDialog(key: number | undefined, type: number): boolean {
    this.dialogType = type;
    if (type === 2 || type === 5) {
      const hook = type === 2 ? this.host.book : this.host.dialog;
      if (!hook || key === undefined) return false;
      this.wait = 'external';
      let sync = true;
      hook.call(this.host, key, () => {
        if (this.wait !== 'external') return;
        this.wait = 'none';
        if (!sync) this.advance();
      });
      sync = false;
      return this.wait === 'external';
    }
    if (type !== 0xff && key !== undefined && key !== 0 && key !== 0xff) {
      const text = this.host.text?.(key);
      this.setText(text);
      if (text === undefined) return false;
      if (type === 3) return false;
      this.wait = 'click';
      return true;
    }
    this.setText(undefined);
    return false;
  }

  private startFade(op: Extract<TtmFrameOp, { op: 'fadeIn' | 'fadeOut' }>): boolean {
    const fadeIn = op.op === 'fadeIn';
    const region = op.startColor < FIRST_PICTURE_COLOR ? FULL : WINDOW;
    const color = this.renderer.paletteColor(op.endColor);
    if (fadeIn) this.present();
    const duration = FADE_SECONDS[op.duration] ?? 0;
    const from = fadeIn ? 1 : 0;
    const to = fadeIn ? 0 : 1;
    this.dirty = true;
    if (duration === 0) {
      this.fade = { color, alpha: to, region };
      return false;
    }
    this.fade = { color, alpha: from, region };
    this.fadeAnim = { from, to, duration, elapsed: 0 };
    this.wait = 'fade';
    return true;
  }
}

// ---- Loading and chapter lists ---------------------------------------------

/** Every resource the frames load: palettes, image sets and screens. */
export function cutsceneResourceNames(frames: readonly TtmFrame[]): string[] {
  const names = new Set<string>();
  for (const f of frames) {
    for (const op of f.ops)
      if (op.op === 'loadPalette' || op.op === 'loadImage' || op.op === 'loadScreen') names.add(op.name);
  }
  return [...names];
}

/** Load a cutscene's scripts and resources and return a player for them (not yet started). */
export async function loadCutscene(
  fetch: FetchResources,
  adsName: string,
  ttmName: string,
  opts: { chapter?: number; host?: CutsceneHost } = {},
): Promise<CutscenePlayer> {
  const scripts = await fetch([adsName, ttmName]);
  const adsBytes = scripts(adsName);
  const ttmBytes = scripts(ttmName);
  if (!adsBytes || !ttmBytes) throw new Error(`cutscene scripts not found: ${adsName} / ${ttmName}`);
  const frames = parseTtmFrames(ttmBytes);
  const read = await fetch(cutsceneResourceNames(frames));
  return new CutscenePlayer({ ads: parseAds(adsBytes), frames, read, ...opts });
}

export type CutsceneStep = { kind: 'ttm'; ads: string; ttm: string } | { kind: 'book'; file: string };

/** The animations and book chapters played when a chapter starts (original order). */
export function chapterStartCutscenes(chapter: number): CutsceneStep[] {
  return [
    { kind: 'ttm', ads: `CHAPTER${chapter}.ADS`, ttm: `CHAPTER${chapter}.TTM` },
    { kind: 'book', file: `C${chapter}1.BOK` },
    { kind: 'ttm', ads: `C${chapter}1.ADS`, ttm: `C${chapter}1.TTM` },
  ];
}

/** The full opening of a new game: the title animation, then chapter 1's card, book and opening scene. */
export function introCutscenes(): CutsceneStep[] {
  return [{ kind: 'ttm', ads: 'INTRO.ADS', ttm: 'INTRO.TTM' }, ...chapterStartCutscenes(1)];
}

/** The book chapter and animation played when a chapter ends; chapter 10 has none. */
export function chapterFinishCutscenes(chapter: number): CutsceneStep[] {
  if (chapter === 10) return [];
  const steps: CutsceneStep[] = [];
  if (![2, 4, 6, 7, 8].includes(chapter)) steps.push({ kind: 'book', file: `C${chapter}2.BOK` });
  const n = chapter === 9 ? 3 : 2;
  steps.push({ kind: 'ttm', ads: `C${chapter}${n}.ADS`, ttm: `C${chapter}${n}.TTM` });
  return steps;
}

/** The dialogue key of a cutscene text number. */
export const cutsceneDialogKey = (n: number): number => 0x186a00 + n;
