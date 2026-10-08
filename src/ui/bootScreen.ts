/**
 * Loading and error screens for the game page: a progress overlay while data and zones load, a
 * friendly error page when startup fails, and a note when WebGPU is missing and WebGL2 is used.
 * Plain DOM over the page, so it works before the renderer or the HUD exist.
 */

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
  /** Hide the loading overlay. */
  done(): void;
  /** Replace the page with a friendly error. */
  fail(err: unknown): void;
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
  box.append(label, bar);
  overlay.append(box);
  parent.append(overlay);
  label.textContent = 'Loading…';

  let failed = false;
  const screen: BootScreen = {
    loading(text, fraction) {
      if (failed) return;
      overlay.style.display = 'grid';
      label.textContent = text;
      bar.style.display = fraction === undefined ? 'none' : 'block';
      if (fraction !== undefined) fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    },
    done() {
      if (!failed) overlay.style.display = 'none';
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

  // Anything that escapes startup (a top-level await in the module rejects) lands here.
  window.addEventListener('unhandledrejection', (e) => screen.fail(e.reason));
  window.addEventListener('error', (e) => screen.fail(e.error ?? e.message));
  return screen;
}
