import { Reader } from './reader';
import { requireTag } from './tagged';

/**
 * FRP.SX: the sound-effect and music resource. See docs/formats/sound.md.
 * Layout learned from xavieran/BaKGL (`bak/soundStore.cpp`, `bak/sound.cpp`), described in our own words.
 */

/** 8-bit unsigned mono PCM. */
export interface WaveVoice {
  kind: 'wave';
  channel: number;
  /** Samples per second. */
  rate: number;
  samples: Uint8Array;
}

/** Note events of a MIDI-style voice, repackaged as a one-track Standard MIDI File. */
export interface MidiVoice {
  kind: 'midi';
  channel: number;
  smf: Uint8Array;
}

export type SxVoice = WaveVoice | MidiVoice;

export interface SxSound {
  /** The selector byte that introduces the sound in the directory. */
  selector: number;
  voices: SxVoice[];
}

export interface SxEntry {
  id: number;
  name: string;
  type: number;
  sounds: SxSound[];
}

export interface SxFile {
  entries: Map<number, SxEntry>;
  /** Entries or voices that could not be read; the rest of the file is still usable. */
  warnings: string[];
}

const WAVE_CODE = 0xfe;
const TIMING = 0xf8;
const SEQ_END = 0xfc;
const TIMING_TICKS = 240;
const MIDI_PPQN = 32;
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL = 0xb0;
const PATCH = 0xc0;
const PITCH = 0xe0;

/** Directory entries: u16 id and u32 file offset, after a 2-byte skip, a u16 count and 1 more byte. */
function parseInf(inf: Uint8Array): { id: number; offset: number }[] {
  const r = new Reader(inf);
  r.skip(2);
  const n = r.u16();
  r.skip(1);
  const out: { id: number; offset: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ id: r.u16(), offset: r.u32() });
  return out;
}

/** Names: u16 count, then count x { u16 id, NUL-terminated string }. */
function parseTags(tag: Uint8Array): Map<number, string> {
  const r = new Reader(tag);
  const n = r.u16();
  const names = new Map<number, string>();
  for (let i = 0; i < n; i++) {
    const id = r.u16();
    let s = '';
    for (let c = r.u8(); c !== 0; c = r.u8()) s += String.fromCharCode(c);
    names.set(id, s);
  }
  return names;
}

export function parseSx(bytes: Uint8Array): SxFile {
  const inf = parseInf(requireTag(bytes, 'INF:'));
  const names = parseTags(requireTag(bytes, 'TAG:'));
  const entries = new Map<number, SxEntry>();
  const warnings: string[] = [];
  for (const { id, offset } of inf) {
    const name = names.get(id);
    if (name === undefined) {
      warnings.push(`sound ${id} has no name`);
      continue;
    }
    try {
      entries.set(id, parseEntry(bytes, id, name, offset));
    } catch (err) {
      warnings.push(`sound ${id} (${name}): ${(err as Error).message}`);
    }
  }
  return { entries, warnings };
}

/**
 * An entry sits behind an 8-byte chunk header: u16 id (repeated), u8 type, 2 unknown bytes, u32 size,
 * 2 more unknown bytes, then `size - 2` bytes of body. The body starts with a directory and the
 * voice data follows; directory offsets count from the start of the body.
 */
function parseEntry(bytes: Uint8Array, id: number, name: string, offset: number): SxEntry {
  const r = new Reader(bytes, offset + 8);
  if (r.u16() !== id) throw new Error('entry id does not match the directory');
  const type = r.u8();
  r.skip(2);
  const size = r.u32();
  r.skip(2);
  const body = r.bytesView(Math.max(0, Math.min(size - 2, r.remaining)));

  const dir = new Reader(body);
  const sounds: SxSound[] = [];
  let selector = dir.u8();
  while (selector !== 0xff) {
    const refs: { offset: number; size: number }[] = [];
    for (let code = dir.u8(); code !== 0xff; code = dir.u8()) {
      dir.skip(1);
      refs.push({ offset: dir.u16(), size: dir.u16() });
    }
    const voices = refs.map((ref) => parseVoice(body.subarray(ref.offset, ref.offset + ref.size)));
    sounds.push({ selector, voices });
    selector = dir.u8();
  }
  return { id, name, type, sounds };
}

function parseVoice(data: Uint8Array): SxVoice {
  const r = new Reader(data);
  const code = r.u8();
  const channel = code & 0x0f;
  r.skip(1);
  if (code === WAVE_CODE) {
    const rate = r.u16();
    const size = r.u32();
    r.skip(2);
    return { kind: 'wave', channel, rate, samples: r.bytesView(Math.min(size, r.remaining)) };
  }
  return { kind: 'midi', channel, smf: midiToSmf(r, channel) };
}

interface TimedEvent {
  tick: number;
  bytes: number[];
}

/**
 * The voice is a stream of { delta, event }. Delta is a byte, preceded by any number of 0xF8 bytes that
 * each add 240 ticks. Events are note-on, control, patch or pitch messages for the voice's channel
 * (the status byte may be omitted to repeat the last one) or 0xFC for the end. Note-on with velocity 0
 * is a note-off.
 */
function midiToSmf(r: Reader, channel: number): Uint8Array {
  const events: TimedEvent[] = [];
  let tick = 0;
  let mode = 0;
  while (mode !== SEQ_END && !r.atEnd()) {
    let delta = 0;
    let code = r.u8();
    while (code === TIMING) {
      delta += TIMING_TICKS;
      code = r.u8();
    }
    delta += code;
    const status = r.u8();
    const kind = status & 0xf0;
    if (kind === NOTE_ON || kind === CONTROL || kind === PATCH || kind === PITCH) {
      if ((status & 0x0f) !== channel) throw new Error('midi event on a different channel');
      mode = status;
    } else if (status === SEQ_END) {
      mode = status;
    } else {
      r.skip(-1);
    }
    if (mode === SEQ_END) break;
    tick += delta;
    switch (mode & 0xf0) {
      case NOTE_ON: {
        const key = r.u8();
        const velocity = r.u8();
        events.push({ tick, bytes: [velocity === 0 ? NOTE_OFF | channel : mode, key, velocity] });
        break;
      }
      case CONTROL:
      case PITCH:
        events.push({ tick, bytes: [mode, r.u8(), r.u8()] });
        break;
      case PATCH:
        events.push({ tick, bytes: [mode, r.u8()] });
        break;
      default:
        throw new Error('midi data is corrupt');
    }
  }
  return buildSmf(events);
}

function varLen(n: number): number[] {
  const out = [n & 0x7f];
  for (n >>>= 7; n > 0; n >>>= 7) out.unshift((n & 0x7f) | 0x80);
  return out;
}

function buildSmf(events: TimedEvent[]): Uint8Array {
  // Stable sort keeps same-tick events in stream order.
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.tick - b.e.tick || a.i - b.i);
  const track: number[] = [];
  let previous = 0;
  for (const { e } of sorted) {
    track.push(...varLen(e.tick - previous), ...e.bytes);
    previous = e.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  return Uint8Array.from([
    ...ascii('MThd'), ...u32(6), 0, 0, 0, 1, 0, MIDI_PPQN,
    ...ascii('MTrk'), ...u32(track.length), ...track,
  ]);
}

/** The first sampled voice of an entry, which is what a sound effect plays. */
export function firstWave(entry: SxEntry): WaveVoice | undefined {
  for (const s of entry.sounds) for (const v of s.voices) if (v.kind === 'wave') return v;
  return undefined;
}

/** 8-bit unsigned PCM to floats in [-1, 1). */
export function waveToFloat(samples: Uint8Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = (samples[i]! - 128) / 128;
  return out;
}
