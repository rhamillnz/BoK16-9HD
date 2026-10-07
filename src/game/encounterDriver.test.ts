import { describe, expect, it } from 'vitest';
import { ENCOUNTER_BLOCK_SIZE, ENCOUNTER_RECORD_SIZE, EncounterType } from '../formats/encounters';
import { GAM_OFFSETS } from '../formats/gam';
import { EncounterDriver, dialogFileName, loadEncounterRunner } from './encounterDriver';
import type { DialogView } from './encounterRunner';
import { getFlag, type WorldState } from './state';

/** One snippet "Hello" under key 7 in a DDX: index of 1, header 9 bytes. */
function ddx(text: string, key: number): Uint8Array {
  const out = new Uint8Array(2 + 8 + 9 + text.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 1, true);
  dv.setUint32(2, key, true);
  dv.setUint32(6, 10, true);
  dv.setUint16(10 + 7, text.length, true);
  for (let i = 0; i < text.length; i++) out[19 + i] = text.charCodeAt(i);
  return out;
}

function tile(typeId: number, completion = 0): Uint8Array {
  const out = new Uint8Array(ENCOUNTER_BLOCK_SIZE);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 1, true);
  const p = 2;
  dv.setUint16(p, typeId, true);
  out.set([1, 1, 1, 1], p + 2);
  dv.setUint16(p + 15, completion, true);
  void ENCOUNTER_RECORD_SIZE;
  return out;
}

const defTable = (key: number) => {
  const out = new Uint8Array(4 + 9);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 1, true);
  dv.setUint32(4 + 3, key, true);
  return out;
};

const world = (): WorldState => ({
  chapter: 1,
  ticks: 0,
  ticksLastSlept: 0,
  bytes: new Uint8Array(GAM_OFFSETS.complexEventFlags + 0x800),
  expiringEvents: [],
});

function files(extra: Record<string, Uint8Array>) {
  const all: Record<string, Uint8Array> = {
    'DEF_DIAL.DAT': defTable(7),
    [dialogFileName(1)]: ddx('Hello', 7),
    ...extra,
  };
  return (name: string) => all[name];
}

describe('loadEncounterRunner and EncounterDriver', () => {
  it('loads a zone and plays a dialogue encounter through the HUD callback', () => {
    const runner = loadEncounterRunner({
      read: files({ 'T010203.DAT': tile(EncounterType.Dialog, 0x600) }),
      zone: 1,
      tiles: [[2, 3]],
      chapter: 1,
      world: world(),
    });
    const shown: DialogView[] = [];
    const driver = new EncounterDriver(runner, (view, done) => {
      shown.push(view);
      done({ kind: 'finish' });
    });
    const inside = [2 * 64000 + 1600 + 5, 3 * 64000 + 1600 + 5] as const;
    driver.update(2 * 64000, 3 * 64000);
    expect(shown).toEqual([]);
    driver.update(...inside);
    expect(shown.map((v) => v.snippet.text)).toEqual(['Hello']);
    expect(driver.busy).toBe(false);
    expect(getFlag(runner.world, 0x600)).toBe(true);
  });

  it('holds off while a dialogue is open and reports other types and blocks', () => {
    const seen: string[] = [];
    let pending: (() => void) | undefined;
    const runner = loadEncounterRunner({
      read: files({ 'T010000.DAT': tile(EncounterType.Block), 'DEF_BLOC.DAT': defTable(7) }),
      zone: 1,
      tiles: [[0, 0]],
      chapter: 1,
      world: world(),
    });
    const driver = new EncounterDriver(
      runner,
      (_view, done) => {
        pending = () => done({ kind: 'finish' });
      },
      {
        blocked: () => seen.push('blocked'),
        other: () => seen.push('other'),
        finished: (_e, c) => seen.push(`finished:${c}`),
      },
    );
    driver.update(1600 + 5, 1600 + 5);
    expect(driver.busy).toBe(true);
    expect(seen).toEqual(['blocked']);
    driver.update(0, 0); // ignored while busy
    pending!();
    expect(seen).toEqual(['blocked', 'finished:false']);
    expect(driver.busy).toBe(false);
  });

  it('logs combat as other and ignores missing files', () => {
    const runner = loadEncounterRunner({
      read: (n) => (n === 'T010000.DAT' ? tile(EncounterType.Combat) : undefined),
      zone: 1,
      tiles: [
        [0, 0],
        [5, 5],
      ],
      chapter: 1,
      world: world(),
    });
    const seen: string[] = [];
    new EncounterDriver(runner, () => {}, { other: () => seen.push('other') }).update(1605, 1605);
    expect(seen).toEqual(['other']);
  });
});
