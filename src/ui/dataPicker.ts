import {
  MemoryStore,
  OpfsStore,
  hasGameData,
  importGameFiles,
  installBakFetch,
  normaliseName,
  type FileStore,
  type GameFile,
} from '../data/gameFiles';

type DirPicker = () => Promise<FileSystemDirectoryHandle>;

async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: GameFile[], depth: number) {
  for await (const [name, handle] of (
    dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
  ).entries()) {
    if (handle.kind === 'file')
      out.push({ path: prefix + name, blob: await (handle as FileSystemFileHandle).getFile() });
    else if (depth > 0 && name.toLowerCase() === 'music')
      await walk(handle as FileSystemDirectoryHandle, 'music/', out, depth - 1);
  }
}

/** Entries of a dropped item, which may be a folder. */
async function dropped(items: DataTransferItemList): Promise<GameFile[]> {
  const out: GameFile[] = [];
  const list = [...items];
  const handles = await Promise.all(
    list.map((i) =>
      (i as unknown as { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.(),
    ),
  );
  for (const [n, h] of handles.entries()) {
    if (h?.kind === 'directory') await walk(h as FileSystemDirectoryHandle, '', out, 1);
    else if (h?.kind === 'file') out.push({ path: h.name, blob: await (h as FileSystemFileHandle).getFile() });
    else {
      const f = list[n]?.getAsFile();
      if (f) out.push({ path: f.name, blob: f });
    }
  }
  return out;
}

/** Files from `<input webkitdirectory>`: paths look like "Betrayal at Krondor/music/bak02.ogg". */
function fromInput(list: FileList): GameFile[] {
  return [...list].map((f) => {
    const rel = (f.webkitRelativePath || f.name).split('/');
    const i = rel.length - 2;
    return {
      path: i >= 0 && rel[i]!.toLowerCase() === 'music' ? `music/${rel[i + 1]}` : rel[rel.length - 1]!,
      blob: f,
    };
  });
}

function overlay(): { root: HTMLElement; body: HTMLElement } {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;inset:0;z-index:200;display:grid;place-items:center;background:#120d08;color:#e8dcc4;font:15px Georgia,serif;text-align:center';
  const body = document.createElement('div');
  body.style.cssText = 'max-width:34em;padding:2em;border:2px solid #7a5c2e;background:#1d150d;border-radius:6px';
  root.append(body);
  document.body.append(root);
  return { root, body };
}

/** Ask for the install folder (picker, drag-and-drop or file input) and resolve with its files. */
function askForFolder(body: HTMLElement, message: string): Promise<GameFile[]> {
  return new Promise((resolve) => {
    body.replaceChildren();
    const h = Object.assign(document.createElement('h2'), { textContent: 'Betrayal at Krondor' });
    const p = Object.assign(document.createElement('p'), {
      textContent:
        message ||
        'Choose the folder where you installed the original game (it contains KRONDOR.RMF). The files stay in this browser; nothing is uploaded.',
    });
    const btn = Object.assign(document.createElement('button'), {
      textContent: 'Choose game folder',
      id: 'pick-folder',
    });
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      multiple: true,
      hidden: true,
      id: 'pick-input',
    });
    input.setAttribute('webkitdirectory', '');
    const hint = Object.assign(document.createElement('p'), { textContent: 'or drop the folder here' });
    hint.style.opacity = '0.7';
    body.append(h, p, btn, input, hint);
    const picker = (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
    btn.onclick = async () => {
      if (!picker) return input.click();
      try {
        const files: GameFile[] = [];
        await walk(await picker.call(window), '', files, 1);
        resolve(files);
      } catch {
        /* cancelled */
      }
    };
    input.onchange = () => input.files?.length && resolve(fromInput(input.files));
    body.ondragover = (e) => e.preventDefault();
    body.ondrop = async (e) => {
      e.preventDefault();
      if (e.dataTransfer) resolve(await dropped(e.dataTransfer.items));
    };
  });
}

async function devServerHasData(): Promise<boolean> {
  try {
    const res = await fetch('/bak/KRONDOR.RMF', { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/**
 * Make sure /bak/ answers. With the dev server (or a host serving /bak/) nothing happens;
 * otherwise use the copy cached in OPFS, or ask for the folder on first run. `?resetdata` forgets the cache.
 */
export async function ensureGameData(): Promise<void> {
  const reset = new URLSearchParams(location.search).has('resetdata');
  const opfs = await OpfsStore.open();
  if (reset) await opfs?.clear();
  else if (await devServerHasData()) return;
  const store: FileStore = opfs ?? new MemoryStore();
  if (!(await hasGameData(store))) {
    const { root, body } = overlay();
    let message = '';
    for (;;) {
      const files = await askForFolder(body, message);
      body.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Reading game files…' }));
      const bar = Object.assign(document.createElement('progress'), { max: 1, value: 0 });
      bar.style.width = '100%';
      const label = document.createElement('p');
      body.append(bar, label);
      try {
        await importGameFiles(store, files, (done, total, name) => {
          bar.value = total ? done / total : 0;
          label.textContent = name ? normaliseName(name) : 'Done';
        });
        break;
      } catch (err) {
        message = `${(err as Error).message}. Choose the folder that contains KRONDOR.RMF.`;
      }
    }
    root.remove();
  }
  window.fetch = installBakFetch(store);
}
