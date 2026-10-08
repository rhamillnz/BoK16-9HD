/**
 * Game-file store for the standalone build. The dev server serves the player's install under
 * /bak/; a static host cannot, so the player picks the folder once, the files we need are copied
 * into the browser's private storage (OPFS), and `window.fetch` is taught to answer /bak/ from
 * there. Nothing is ever uploaded anywhere.
 */

export const REQUIRED_FILES = ['KRONDOR.RMF', 'KRONDOR.001'];
const BAK_PREFIX = '/bak/';

/** Normalise a path inside the install folder: forward slashes, no leading slash, upper case for data files. */
export function normaliseName(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
  return clean.toLowerCase().startsWith('music/') ? `music/${clean.slice(6).toLowerCase()}` : clean.toUpperCase();
}

/** Whether a file inside the install folder is worth caching: archives, saves, sound bank, music. */
export function isCacheable(path: string): boolean {
  const name = normaliseName(path);
  if (name.startsWith('music/')) return /^music\/[^/]+\.(ogg|mp3)$/.test(name);
  return !name.includes('/') && /\.(RMF|001|GAM|SX)$/.test(name);
}

export interface GameFile {
  /** Path relative to the install folder, e.g. "KRONDOR.RMF" or "music/bak02.ogg". */
  path: string;
  blob: Blob;
}

export interface FileStore {
  get(name: string): Promise<Blob | undefined>;
  put(name: string, blob: Blob): Promise<void>;
  has(name: string): Promise<boolean>;
  clear(): Promise<void>;
}

export class MemoryStore implements FileStore {
  private readonly files = new Map<string, Blob>();
  async get(name: string) { return this.files.get(normaliseName(name)); }
  async put(name: string, blob: Blob) { this.files.set(normaliseName(name), blob); }
  async has(name: string) { return this.files.has(normaliseName(name)); }
  async clear() { this.files.clear(); }
}

/** OPFS keeps one flat file per game file; "/" is encoded so music files stay top-level. */
const encodeKey = (name: string) => normaliseName(name).replace(/\//g, '__');

export class OpfsStore implements FileStore {
  private constructor(private readonly dir: FileSystemDirectoryHandle) {}

  static async open(): Promise<OpfsStore | undefined> {
    try {
      const root = await navigator.storage?.getDirectory?.();
      return root ? new OpfsStore(await root.getDirectoryHandle('bak-data', { create: true })) : undefined;
    } catch {
      return undefined;
    }
  }

  async get(name: string) {
    try {
      return await (await this.dir.getFileHandle(encodeKey(name))).getFile();
    } catch {
      return undefined;
    }
  }

  async has(name: string) { return (await this.get(name)) !== undefined; }

  async put(name: string, blob: Blob) {
    const handle = await this.dir.getFileHandle(encodeKey(name), { create: true });
    const out = await handle.createWritable();
    await out.write(blob);
    await out.close();
  }

  async clear() {
    for await (const key of (this.dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      await this.dir.removeEntry(key).catch(() => {});
    }
  }
}

/** Pick the cacheable files from a flat list of folder entries, checking the required ones exist. */
export function selectGameFiles(files: GameFile[]): { files: GameFile[]; missing: string[] } {
  const keep = files.filter((f) => isCacheable(f.path));
  const have = new Set(keep.map((f) => normaliseName(f.path)));
  return { files: keep, missing: REQUIRED_FILES.filter((n) => !have.has(n)) };
}

/** Copy files into the store, reporting progress by bytes. Throws if a required file is missing. */
export async function importGameFiles(
  store: FileStore,
  files: GameFile[],
  onProgress: (done: number, total: number, name: string) => void = () => {},
): Promise<void> {
  const { files: keep, missing } = selectGameFiles(files);
  if (missing.length) throw new Error(`${missing.join(' and ')} not found in that folder`);
  const total = keep.reduce((n, f) => n + f.blob.size, 0);
  let done = 0;
  for (const f of keep) {
    onProgress(done, total, f.path);
    await store.put(f.path, f.blob);
    done += f.blob.size;
  }
  onProgress(total, total, '');
}

export async function hasGameData(store: FileStore): Promise<boolean> {
  return (await Promise.all(REQUIRED_FILES.map((n) => store.has(n)))).every(Boolean);
}

/** Make `fetch('/bak/...')` read from the store; every other request goes to the real fetch. */
export function installBakFetch(store: FileStore, realFetch: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = raw.startsWith('/') ? raw : new URL(raw).pathname;
    const sameOrigin = raw.startsWith('/') || new URL(raw).origin === location.origin;
    if (!sameOrigin || !path.startsWith(BAK_PREFIX)) return realFetch(input, init);
    const blob = await store.get(decodeURIComponent(path.slice(BAK_PREFIX.length)));
    if (!blob) return new Response(null, { status: 404 });
    return new Response(blob, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
  };
}
