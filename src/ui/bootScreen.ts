/**
 * Loading and error screens for the game page: a progress overlay while data and zones load, a
 * friendly error page when startup fails, and a note when WebGPU is missing and WebGL2 is used.
 * Plain DOM over the page, so it works before the renderer or the HUD exist.
 */

import { PANORAMA, slideAt } from './loadingArt';

/** Startup failed because the original game files could not be fetched. */
export class GameDataError extends Error {
  constructor(
    readonly file: string,
    readonly status?: number,
  ) {
    super(`Game data not found: ${file}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'GameDataError';
  }
}

export interface FriendlyError {
  title: string;
  message: string;
  hint: string;
  /** The raw message, shown small for bug reports. */
  detail: string;
}

export interface Capabilities {
  webgpu: boolean;
  webgl2: boolean;
}

export function detectCapabilities(): Capabilities {
  let webgl2 = false;
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  return { webgpu: 'gpu' in navigator, webgl2 };
}

const NO_GRAPHICS = /webgpu|webgl|getcontext|adapter|no (suitable )?backend/i;

/** Turn whatever startup threw into text a player can act on. Pure, so it is easy to test. */
export function describeStartupError(err: unknown, caps: Capabilities = { webgpu: true, webgl2: true }): FriendlyError {
  const detail = err instanceof Error ? err.message : String(err);
  if (err instanceof GameDataError || /game data not found/i.test(detail)) {
    return {
      title: 'Game data not found',
      message:
        'This remake needs the files from your own copy of Betrayal at Krondor, and the game could not read them.',
      hint: 'Point BAK_DIR at your install folder (the one with KRONDOR.RMF, KRONDOR.001 and STARTUP.GAM) and restart the dev server. See the README.',
      detail,
    };
  }
  if ((!caps.webgpu && !caps.webgl2) || NO_GRAPHICS.test(detail)) {
    return {
      title: 'Graphics not available',
      message: caps.webgpu
        ? 'The browser could not start the graphics system.'
        : 'This browser has neither WebGPU nor WebGL2, so the game cannot draw.',
      hint: 'Use a current Chrome, Edge, Firefox or Safari, make sure hardware acceleration is on, and update your graphics drivers.',
      detail,
    };
  }
  if (
    err instanceof RangeError ||
    err instanceof TypeError ||
    /unsupported|corrupt|invalid|unexpected|out of range|bounds/i.test(detail)
  ) {
    return {
      title: 'Game data looks wrong',
      message:
        'The game files were found but could not be understood. They may be damaged, incomplete or from a different edition.',
      hint: 'Check that the folder holds an unmodified install of the original DOS game (the CD or GOG version) and try again.',
      detail,
    };
  }
  return {
    title: 'Something went wrong',
    message: 'The game stopped while starting up.',
    hint: 'Reload the page. If it keeps happening, open the browser console (F12) and report the message below.',
    detail,
  };
}

/** One line for the status banner when the renderer fell back from WebGPU to WebGL2, or undefined when none is needed. */
export function backendNote(backend: 'WebGPU' | 'WebGL2'): string | undefined {
  return backend === 'WebGL2'
    ? 'WebGPU is not available in this browser, so the game is using the WebGL2 fallback. It works, but may look plainer and run slower.'
    : undefined;
}

export interface BootScreen {
  /** Show or update the loading overlay. `fraction` is 0..1 when known. */
  loading(label: string, fraction?: number): void;
  /**
   * Paint a picture behind the loading bar (the title screen once the game data is read). `paint` draws the
   * whole canvas and returns where the label and bar go, as a 0..1 fraction of its height.
   */
  backdrop(paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => number): void;
  /**
   * A slideshow of the town views behind the bar, from the first frame (and on every later zone load). `slides`
   * may still be filling; the title backdrop is used while it is empty. `logo` (the game's title picture, once the
   * data is read) is drawn above the pictures.
   */
  slideshow(slides: readonly HTMLImageElement[], logo?: () => CanvasImageSource | undefined): void;
  /**
   * Resolves once the loading art is on screen (or after `timeoutMs` without it). Call before work that holds the
   * page up for seconds (building a zone), which stops the screen updating: whatever is showing stays up.
   */
  painted(timeoutMs?: number): Promise<void>;
  /** Hide the loading overlay. The first call ends startup: later errors show a notice, not the error page. */
  done(): void;
  /** Replace the page with a friendly error. */
  fail(err: unknown): void;
  /** A problem after startup: logged, and shown as a notice the game carries on under. */
  notice(err: unknown): void;
  /** Show the fallback note for a few seconds if the backend needs one. */
  backend(backend: 'WebGPU' | 'WebGL2'): void;
}

const STYLE =
  'position:fixed;inset:0;display:grid;place-items:center;background:#0d0a06;color:#f3e6c4;font:18px/1.5 system-ui,sans-serif;z-index:100;text-align:center;';

export function installBootScreen(parent: HTMLElement = document.body): BootScreen {
  const overlay = Object.assign(document.createElement('div'), { id: 'boot-screen' });
  overlay.setAttribute('role', 'status');
  overlay.style.cssText = STYLE;
  const label = document.createElement('div');
  const bar = document.createElement('div');
  bar.style.cssText =
    'width:320px;height:8px;margin:14px auto 0;border:1px solid #c9a24a;border-radius:4px;overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:0;background:#c9a24a;transition:width 0.2s;';
  bar.append(fill);
  const box = document.createElement('div');
  box.style.cssText = 'position:relative;';
  box.append(label, bar);
  overlay.append(box);
  parent.append(overlay);
  label.textContent = 'Loading…';

  let failed = false;
  let started = false;
  let art: HTMLCanvasElement | undefined;
  let paintArt: ((ctx: CanvasRenderingContext2D, width: number, height: number) => number) | undefined;
  let show: { slides: readonly HTMLImageElement[]; logo?: () => CanvasImageSource | undefined } | undefined;
  const t0 = performance.now();
  const canvas = () => {
    if (!art) {
      art = document.createElement('canvas');
      art.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      overlay.prepend(art);
    }
    if (art.width !== innerWidth || art.height !== innerHeight) {
      art.width = innerWidth;
      art.height = innerHeight;
    }
    return art;
  };
  const style = (onParchment: boolean) => {
    label.style.cssText = onParchment
      ? 'color:#3a2210;font-weight:600;text-shadow:0 1px 0 rgba(255,230,180,0.5);'
      : 'color:#f3e6c4;font:italic 20px/1.5 Georgia,serif;text-shadow:0 2px 4px #000;';
    bar.style.background = onParchment ? 'rgba(40,24,10,0.35)' : 'rgba(0,0,0,0.5)';
    bar.style.borderColor = onParchment ? '#6b4318' : '#c9a24a';
    fill.style.background = onParchment ? '#7a2a10' : '#c9a24a';
  };
  const placeBox = (at: number) => {
    box.style.cssText = `position:absolute;left:0;right:0;top:${(at * 100).toFixed(1)}%;`;
  };
  /** One frame of the slideshow; false when there is nothing to show yet. */
  const drawSlides = (): boolean => {
    if (!show || (show.slides.length === 0 && paintArt)) return false;
    const c = canvas();
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    ctx.fillStyle = '#080604';
    ctx.fillRect(0, 0, W, H);
    if (show.slides.length === 0) {
      // The first picture is still on its way: just the name.
      ctx.fillStyle = '#e8c868';
      ctx.font = `bold ${Math.round(Math.min(56, H * 0.07))}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Betrayal at Krondor', W / 2, H * 0.45);
      placeBox(0.5);
      return true;
    }
    const pw = Math.min(W * 0.84, H * 0.5 * (PANORAMA.width / PANORAMA.height));
    const ph = pw * (PANORAMA.height / PANORAMA.width);
    const px = (W - pw) / 2;
    const py = H * 0.52 - ph / 2;
    const s = slideAt((performance.now() - t0) / 1000, show.slides.length);
    const paint = (index: number, zoom: number, alpha: number) => {
      const img = show!.slides[index];
      if (!img || alpha <= 0) return;
      const k = img.naturalWidth / 320;
      const sw = (PANORAMA.width * k) / zoom;
      const sh = (PANORAMA.height * k) / zoom;
      // Drift sideways as it zooms, alternating direction from one picture to the next.
      const drift = (index % 2 ? 1 : -1) * (PANORAMA.width * k - sw) * 0.4;
      const sx = PANORAMA.x * k + (PANORAMA.width * k - sw) / 2 + drift;
      const sy = PANORAMA.y * k + (PANORAMA.height * k - sh) / 2;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, sx, sy, sw, sh, px, py, pw, ph);
      ctx.globalAlpha = 1;
    };
    ctx.imageSmoothingEnabled = true;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 30;
    ctx.fillRect(px, py, pw, ph);
    ctx.shadowBlur = 0;
    paint(s.current, s.zoom, 1);
    if (show.slides.length > 1) paint(s.next, s.nextZoom, s.fade);
    ctx.strokeStyle = '#c9a24a';
    ctx.lineWidth = 2;
    ctx.strokeRect(px - 4, py - 4, pw + 8, ph + 8);
    const logo = show.logo?.() as (CanvasImageSource & { width: number; height: number }) | undefined;
    const top = py - 8;
    if (logo) {
      const lh = Math.min(top - H * 0.04, H * 0.24);
      const lw = (lh * logo.width) / logo.height;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(logo, (W - lw) / 2, top - lh - H * 0.015, lw, lh);
    } else {
      ctx.fillStyle = '#e8c868';
      ctx.font = `bold ${Math.round(Math.min(56, top * 0.4))}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Betrayal at Krondor', W / 2, top - 12);
    }
    placeBox((py + ph + 24) / H);
    return true;
  };
  let frame = 0;
  const tick = () => {
    frame = 0;
    if (failed || overlay.style.display === 'none') return;
    if (drawSlides()) style(false);
    else repaint();
    frame = requestAnimationFrame(tick);
  };
  const run = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };
  let painted = '';
  const repaint = () => {
    if (!paintArt || (show && show.slides.length > 0)) return;
    const key = `${innerWidth}x${innerHeight}`;
    if (painted === key) return;
    painted = key;
    const c = canvas();
    const at = paintArt(c.getContext('2d')!, c.width, c.height);
    style(true);
    placeBox(at);
  };
  addEventListener('resize', repaint);
  const screen: BootScreen = {
    loading(text, fraction) {
      if (failed) return;
      overlay.style.display = 'grid';
      run();
      label.textContent = text;
      bar.style.display = fraction === undefined ? 'none' : 'block';
      if (fraction !== undefined) fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    },
    backdrop(paint) {
      if (failed) return;
      paintArt = paint;
      painted = '';
      repaint();
    },
    async painted(timeoutMs = 1500) {
      const until = performance.now() + timeoutMs;
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
      while (!(show && show.slides.length > 0) && !paintArt && performance.now() < until) await frame();
      // Two frames: one to draw the picture, one for the browser to put it on screen.
      await frame();
      await frame();
    },
    slideshow(slides, logo) {
      if (failed) return;
      show = { slides, logo };
      run();
    },
    done() {
      started = true;
      if (!failed) overlay.style.display = 'none';
    },
    notice(err) {
      console.error(err);
      const text = err instanceof Error ? err.message : String(err);
      const el = Object.assign(document.createElement('div'), {
        className: 'error-notice',
        textContent: `Something went wrong, but the game carries on: ${text.split('\n')[0]!.slice(0, 160)}`,
      });
      el.setAttribute('role', 'alert');
      el.style.cssText =
        'position:fixed;left:50%;top:3%;transform:translateX(-50%);max-width:70%;padding:8px 18px;background:rgba(40,12,8,0.92);' +
        'border:1px solid #c9654a;border-radius:6px;color:#f3e6c4;font:14px system-ui,sans-serif;pointer-events:none;z-index:150;transition:opacity 0.6s;';
      parent.append(el);
      setTimeout(() => (el.style.opacity = '0'), 7000);
      setTimeout(() => el.remove(), 8000);
    },
    fail(err) {
      if (failed) return;
      failed = true;
      console.error(err);
      const e = describeStartupError(err, detectCapabilities());
      overlay.id = 'boot-error';
      overlay.setAttribute('role', 'alert');
      overlay.style.display = 'grid';
      overlay.replaceChildren();
      const card = document.createElement('div');
      card.style.cssText =
        'max-width:560px;padding:28px 34px;border:2px solid #c9a24a;border-radius:6px;background:#1b140b;';
      const h = Object.assign(document.createElement('h1'), { textContent: e.title });
      h.style.cssText = 'margin:0 0 10px;font-size:28px;color:#e8c868;';
      const m = Object.assign(document.createElement('p'), { textContent: e.message });
      const hint = Object.assign(document.createElement('p'), { textContent: e.hint });
      hint.style.color = '#c8bb98';
      const d = Object.assign(document.createElement('code'), { textContent: e.detail });
      d.style.cssText = 'display:block;margin-top:14px;font-size:12px;color:#8a7f66;word-break:break-word;';
      card.append(h, m, hint, d);
      overlay.append(card);
    },
    backend(backend) {
      const note = backendNote(backend);
      if (!note) return;
      const el = Object.assign(document.createElement('div'), { id: 'backend-note', textContent: note });
      el.style.cssText =
        'position:fixed;left:50%;bottom:4%;transform:translateX(-50%);max-width:70%;padding:8px 18px;background:rgba(20,16,10,0.88);' +
        'border:1px solid #c9a24a;border-radius:6px;color:#f3e6c4;font:14px system-ui,sans-serif;pointer-events:none;z-index:50;transition:opacity 0.6s;';
      parent.append(el);
      setTimeout(() => (el.style.opacity = '0'), 9000);
      setTimeout(() => el.remove(), 10000);
    },
  };

  // Anything that escapes startup (a top-level await in the module rejects) lands here. Once the game is
  // running, a stray error must not wipe it: it becomes a notice instead.
  const caught = (err: unknown) => (started ? screen.notice(err) : screen.fail(err));
  window.addEventListener('unhandledrejection', (e) => caught(e.reason));
  window.addEventListener('error', (e) => caught(e.error ?? e.message));
  return screen;
}
