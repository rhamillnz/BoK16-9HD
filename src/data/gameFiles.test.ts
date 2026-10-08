import { describe, expect, it } from 'vitest';
import { MemoryStore, hasGameData, importGameFiles, installBakFetch, isCacheable, normaliseName, selectGameFiles } from './gameFiles';

const file = (path: string, text = 'x') => ({ path, blob: new Blob([text]) });

describe('gameFiles', () => {
  it('normalises names case-insensitively', () => {
    expect(normaliseName('krondor.rmf')).toBe('KRONDOR.RMF');
    expect(normaliseName('Music\\BAK02.OGG')).toBe('music/bak02.ogg');
  });

  it('caches archives, saves, sounds and music only', () => {
    expect(isCacheable('KRONDOR.RMF')).toBe(true);
    expect(isCacheable('startup.gam')).toBe(true);
    expect(isCacheable('frp.sx')).toBe(true);
    expect(isCacheable('music/bak02.ogg')).toBe(true);
    expect(isCacheable('BAK.EXE')).toBe(false);
    expect(isCacheable('sub/KRONDOR.RMF')).toBe(false);
  });

  it('reports missing required files', () => {
    expect(selectGameFiles([file('KRONDOR.RMF'), file('readme.txt')]).missing).toEqual(['KRONDOR.001']);
  });

  it('refuses a folder without the archives', async () => {
    await expect(importGameFiles(new MemoryStore(), [file('STARTUP.GAM')])).rejects.toThrow(/KRONDOR\.RMF/);
  });

  it('imports with progress and serves /bak/ from the store', async () => {
    const store = new MemoryStore();
    const seen: number[] = [];
    await importGameFiles(store, [file('krondor.rmf', 'ab'), file('KRONDOR.001', 'cde'), file('music/bak02.ogg', 'z')], (d, t) => seen.push(d / t));
    expect(seen.at(-1)).toBe(1);
    expect(await hasGameData(store)).toBe(true);
    const f = installBakFetch(store, async () => new Response('real'));
    expect(await (await f('/bak/KRONDOR.RMF')).text()).toBe('ab');
    expect(await (await f('/bak/music/bak02.ogg')).text()).toBe('z');
    expect((await f('/bak/NOPE.GAM')).status).toBe(404);
    expect(await (await f('/other.json')).text()).toBe('real');
  });
});
