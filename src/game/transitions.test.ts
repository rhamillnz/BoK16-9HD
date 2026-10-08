import { describe, expect, it } from 'vitest';
import { ActionType, parseDDX } from '../formats/ddx';
import { CELL_SIZE, TILE_SIZE } from '../formats/world';
import { DialogSession, DialogStore, QUERY_NO, QUERY_YES } from './encounterRunner';
import { resolveDialogOutcome } from './dialogOutcome';
import type { PartyState } from './party';
import type { WorldState } from './state';
import {
  destinationAt,
  entryPointForZone,
  parseTeleports,
  parseZoneTransitions,
  planTransition,
  TELEPORT_RECORD_SIZE,
  ZONE_RECORD_SIZE,
  type Destination,
  type ZoneTransition,
} from './transitions';

describe('parseTeleports', () => {
  it('reads zone, tile, cell, heading and hotspot, with 0xff meaning the same zone', () => {
    const bytes = new Uint8Array(2 * TELEPORT_RECORD_SIZE);
    const dv = new DataView(bytes.buffer);
    bytes.set([3, 4, 5, 6, 7], 0);
    dv.setUint16(5, 0x4000, true);
    dv.setUint16(7, 12, true);
    dv.setUint16(9, 3, true);
    bytes.set([0xff, 1, 2, 0, 0], TELEPORT_RECORD_SIZE);
    const [a, b] = parseTeleports(bytes);
    expect(a).toEqual({
      zone: 3, tileX: 4, tileY: 5,
      x: 4 * TILE_SIZE + 6 * CELL_SIZE + CELL_SIZE / 2,
      y: 5 * TILE_SIZE + 7 * CELL_SIZE + CELL_SIZE / 2,
      heading: 0x40, hotspot: 12, hotspotChar: 3,
    });
    expect(b!.zone).toBeUndefined();
    expect(b!.hotspot).toBeUndefined();
  });

  it('ignores a trailing partial record', () => {
    expect(parseTeleports(new Uint8Array(TELEPORT_RECORD_SIZE + 4))).toHaveLength(1);
  });
});

describe('parseZoneTransitions', () => {
  it('reads 20-byte records after the count, with the dialogue key', () => {
    const bytes = new Uint8Array(4 + ZONE_RECORD_SIZE);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, 1, true);
    bytes.set([0, 0, 0, 7, 2, 9, 10, 11], 4);
    dv.setUint16(4 + 8, 0x8000, true);
    dv.setUint32(4 + 10, 0x1234, true);
    expect(parseZoneTransitions(bytes)).toEqual([{ ...destinationAt(7, 2, 9, 10, 11, 0x8000), dialog: 0x1234 }]);
  });

  it('clamps a count that runs past the file', () => {
    const bytes = new Uint8Array(4 + ZONE_RECORD_SIZE);
    new DataView(bytes.buffer).setUint32(0, 9, true);
    expect(parseZoneTransitions(bytes)).toHaveLength(1);
  });
});

describe('planTransition', () => {
  const d = (zone: number | undefined): Destination => destinationAt(zone, 1, 1, 0, 0, 0x8000);

  it('reloads only when the zone changes', () => {
    expect(planTransition(1, d(2)).reload).toBe(true);
    expect(planTransition(2, d(2)).reload).toBe(false);
    expect(planTransition(2, d(undefined))).toMatchObject({ reload: false, zone: 2, heading: 0x80 });
  });
});

// ---- outcome of a finished dialogue ----------------------------------------

const world = (): WorldState => ({ chapter: 1, ticks: 0, ticksLastSlept: 0, bytes: new Uint8Array(0x4000), expiringEvents: [] });
const party: PartyState = { gold: 5, characters: [], activeCharacters: [], partyKeys: { capacity: 4, items: [] } };

/** One snippet (key 1) with the given actions, plus an optional Yes/No query. */
function session(actions: { type: number; words: number[] }[], query = false): DialogSession {
  const header = 9;
  const choiceBytes = query ? 20 : 0;
  const size = header + choiceBytes + actions.length * 10 + 1;
  const out = new Uint8Array(10 + size);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 1, true);
  dv.setUint32(2, 1, true);
  dv.setUint32(6, 10, true);
  const p = 10;
  dv.setUint8(p + 4, query ? 2 : 0);
  dv.setUint8(p + 5, query ? 2 : 0);
  dv.setUint8(p + 6, actions.length);
  dv.setUint16(p + 7, 1, true);
  let q = p + header;
  if (query) {
    dv.setUint16(q, QUERY_YES, true);
    dv.setUint16(q + 4, 0xffff, true);
    dv.setUint16(q + 10, QUERY_NO, true);
    dv.setUint16(q + 14, 0xffff, true);
    q += 20;
  }
  for (const a of actions) {
    dv.setUint16(q, a.type, true);
    a.words.forEach((w, k) => dv.setUint16(q + 2 + k * 2, w, true));
    q += 10;
  }
  out[q] = 'x'.charCodeAt(0);
  const s = new DialogSession(new DialogStore(new Map([[1, parseDDX(out)]])), world());
  s.start(1);
  return s;
}

const stay: ZoneTransition = { ...destinationAt(5, 1, 1, 0, 0, 0), dialog: 1 };
const teleports = [destinationAt(2, 1, 1, 0, 0, 0), destinationAt(3, 4, 4, 0, 0, 0)];

describe('resolveDialogOutcome', () => {
  it('applies pending actions and teleports through TELEPORT.DAT', () => {
    const s = session([
      { type: ActionType.GiveItem, words: [53, 2, 0, 0] },
      { type: ActionType.Teleport, words: [1] },
    ]);
    const o = resolveDialogOutcome({ session: s, party, teleports });
    expect(o.destination?.zone).toBe(3);
    expect(o.party.gold).toBe(5 + 2 * 10); // two sovereigns
  });

  it('warns when the teleport index is unknown', () => {
    const s = session([{ type: ActionType.Teleport, words: [9] }]);
    const o = resolveDialogOutcome({ session: s, party, teleports });
    expect(o.destination).toBeUndefined();
    expect(o.warnings[0]).toMatch(/teleport 9/);
  });

  it('takes the zone transition after its dialogue', () => {
    const s = session([]);
    expect(resolveDialogOutcome({ session: s, party, transition: stay }).destination?.zone).toBe(5);
  });

  it('stays put when the dialogue was cancelled or the player said no', () => {
    const cancelled = session([]);
    expect(resolveDialogOutcome({ session: cancelled, party, transition: stay, cancelled: true }).destination).toBeUndefined();

    const no = session([], true);
    no.choose(QUERY_NO);
    expect(resolveDialogOutcome({ session: no, party, transition: stay }).destination).toBeUndefined();

    const yes = session([], true);
    yes.choose(QUERY_YES);
    expect(resolveDialogOutcome({ session: yes, party, transition: stay }).destination?.zone).toBe(5);
  });
});

describe('entryPointForZone', () => {
  it('returns the first plain teleport into the zone', () => {
    const a = destinationAt(undefined, 1, 1, 0, 0, 0);
    const b = destinationAt(10, 3, 4, 5, 6, 0x4000);
    const c = destinationAt(10, 9, 9, 0, 0, 0);
    expect(entryPointForZone(10, [a, b, c])).toBe(b);
    expect(entryPointForZone(11, [a, b, c])).toBeUndefined();
  });

  it('skips teleports into a town or temple', () => {
    const town = { ...destinationAt(10, 1, 1, 0, 0, 0), hotspot: 3 };
    const plain = destinationAt(10, 2, 2, 0, 0, 0);
    expect(entryPointForZone(10, [town, plain])).toBe(plain);
  });
});
