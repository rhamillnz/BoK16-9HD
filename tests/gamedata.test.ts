import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ResourceArchive } from '../src/formats/archive';
import { parseBMX } from '../src/formats/bmx';
import { parsePalette } from '../src/formats/palette';

// Integration tests against the user's own game install. Skipped if not present.
const BAK_DIR = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const hasData = existsSync(path.join(BAK_DIR, 'KRONDOR.RMF'));

describe.skipIf(!hasData)('original game data', () => {
  const archive = hasData
    ? new ResourceArchive(
        readFileSync(path.join(BAK_DIR, 'KRONDOR.RMF')),
        readFileSync(path.join(BAK_DIR, 'KRONDOR.001')),
      )
    : undefined!;

  it('indexes the archive', () => {
    expect(archive.entries.length).toBeGreaterThan(1000);
    expect(archive.has('OPTIONS.PAL')).toBe(true);
  });

  it('parses every palette', () => {
    const pals = archive.entries.filter((e) => e.name.endsWith('.PAL'));
    expect(pals.length).toBeGreaterThan(10);
    for (const e of pals) {
      expect(parsePalette(archive.get(e.name)).length, e.name).toBe(1024);
    }
  });

  it('decodes every BMX image set fully', () => {
    const failures: string[] = [];
    const bmxs = archive.entries.filter((e) => e.name.endsWith('.BMX'));
    for (const e of bmxs) {
      try {
        const images = parseBMX(archive.get(e.name));
        if (images.length === 0) failures.push(`${e.name}: no images`);
        for (const img of images) {
          if (img.pixels.length !== img.width * img.height) failures.push(`${e.name}: bad size`);
        }
      } catch (err) {
        failures.push(`${e.name}: ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
