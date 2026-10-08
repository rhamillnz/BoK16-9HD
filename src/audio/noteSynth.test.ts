import { describe, expect, it } from 'vitest';
import { SfxPlayer, type SfxContextLike } from './sfx';
import { MAX_NOTES, midiFrequency, NoteSynth, scheduleNotes, waveFor } from './noteSynth';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
const chunk = (tag: string, body: number[]) => [...ascii(tag), ...u32(body.length), ...body];

function smf(track: number[]): Uint8Array {
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const t = [...track, 0, 0xff, 0x2f, 0];
  return Uint8Array.from([...ascii('MThd'), ...be32(6), 0, 0, 0, 1, 0, 32, ...ascii('MTrk'), ...be32(t.length), ...t]);
}

// patch 25 on channel 0, note-on key 69 at tick 0, note-off after 32 ticks (one quarter = 0.5 s)
const TRACK = [0, 0xc0, 25, 0, 0x90, 69, 100, 32, 0x80, 69, 0];

describe('scheduleNotes', () => {
  it('pairs note-on with note-off and uses 120 bpm', () => {
    const notes = scheduleNotes(smf(TRACK));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ key: 69, program: 25, start: 0, bend: 0 });
    expect(notes[0]!.duration).toBeCloseTo(0.5);
  });

  it('lets an unreleased note ring to the end and rejects junk', () => {
    const notes = scheduleNotes(smf([0, 0x90, 60, 90, 32, 0xb0, 7, 100]));
    expect(notes[0]!.duration).toBeCloseTo(0.5);
    expect(scheduleNotes(new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  it('caps the number of notes in a runaway stream', () => {
    const track = Array.from({ length: MAX_NOTES + 50 }, () => [0, 0x90, 60, 90, 1, 0x80, 60, 0]).flat();
    expect(scheduleNotes(smf(track))).toHaveLength(MAX_NOTES);
  });

  it('applies the pitch wheel at note start', () => {
    const notes = scheduleNotes(smf([0, 0xe0, 0x7f, 0x7f, 0, 0x90, 69, 100, 8, 0x80, 69, 0]));
    expect(notes[0]!.bend).toBeCloseTo(2, 1);
  });
});

describe('helpers', () => {
  it('maps keys to frequencies and patches to waves', () => {
    expect(midiFrequency(69)).toBe(440);
    expect(midiFrequency(81)).toBeCloseTo(880);
    expect(waveFor(0)).toBe('triangle');
    expect(waveFor(25)).toBe('square');
    expect(waveFor(80)).toBe('sawtooth');
  });
});

function fakeCtx() {
  const oscs: { type: string; freq: number; started: number[]; stopped: number[]; onended: (() => void) | null }[] = [];
  const param = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const gain = () => ({ gain: param(), connect() {}, disconnect() {} });
  const ctx = {
    currentTime: 1,
    state: 'running',
    destination: {},
    createGain: gain,
    createBufferSource: () => {
      throw new Error('no wave expected');
    },
    createBuffer: () => {
      throw new Error('no wave expected');
    },
    createOscillator: () => {
      const o = {
        type: '',
        freq: 0,
        started: [] as number[],
        stopped: [] as number[],
        onended: null as (() => void) | null,
        frequency: {
          ...param(),
          set value(v: number) {
            o.freq = v;
          },
        },
        connect() {},
        disconnect() {},
        start(t = 0) {
          o.started.push(t);
        },
        stop(t = 0) {
          o.stopped.push(t);
        },
      };
      oscs.push(o);
      return o;
    },
    resume: async () => {},
  };
  return { ctx: ctx as unknown as SfxContextLike, oscs };
}

describe('NoteSynth', () => {
  it('starts one oscillator per note at the right pitch and time', () => {
    const { ctx, oscs } = fakeCtx();
    const h = new NoteSynth(ctx as never, {}).play(smf(TRACK));
    expect(oscs).toHaveLength(1);
    expect(oscs[0]!.freq).toBe(440);
    expect(oscs[0]!.started[0]).toBeCloseTo(1.01);
    expect(h!.duration).toBeCloseTo(0.56);
  });

  it('plays nothing for an empty stream', () => {
    const { ctx, oscs } = fakeCtx();
    expect(new NoteSynth(ctx as never, {}).play(smf([]))).toBeUndefined();
    expect(oscs).toHaveLength(0);
  });
});

describe('SfxPlayer with a note-only effect', () => {
  it('synthesises an entry that has no wave voice', async () => {
    // Voice data: code 0x00 (channel 0), skipped byte, then { delta, event } pairs.
    const voice = [0x00, 0, 0, 0x90, 60, 100, 32, 0x90, 60, 0, 0, 0xfc];
    const dir = [1, 1, 0, ...u16(9), ...u16(voice.length), 0xff, 0xff];
    const body = [...dir, ...voice];
    const entry = chunk('SND:', [...u16(70), 1, 0, 0, ...u32(body.length + 2), 0, 0, ...body]);
    const tag = chunk('TAG:', [...u16(1), ...u16(70), ...ascii('BLIP'), 0]);
    const inf = chunk('INF:', [0, 0, ...u16(1), 0, ...u16(70), ...u32(8 + 5 + 6 + tag.length)]);
    const file = Uint8Array.from([...inf, ...tag, ...entry]).buffer;
    const { ctx, oscs } = fakeCtx();
    const p = new SfxPlayer({ context: ctx, fetchBytes: async () => file });
    await p.play(70);
    expect(oscs).toHaveLength(1);
    expect(oscs[0]!.freq).toBeCloseTo(midiFrequency(60));
  });
});
