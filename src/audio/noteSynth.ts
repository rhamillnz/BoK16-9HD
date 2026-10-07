import type { AudioNodeLike, AudioParamLike, GainNodeLike } from './music';

/**
 * A small WebAudio synth for the note-only voices of FRP.SX. The voice arrives as the one-track
 * Standard MIDI File made by src/formats/sx.ts; `scheduleNotes` turns it into timed notes and
 * `NoteSynth` plays them with plain oscillators. See docs/formats/sound.md.
 */

/** The file carries no tempo, so the MIDI default of 120 beats per minute applies. */
const MICROS_PER_QUARTER = 500_000;
/** Longest an effect may ring, in seconds; a runaway stream is cut here. */
export const MAX_NOTE_SECONDS = 12;
const RELEASE = 0.06;
const ATTACK = 0.004;

export interface Note {
  channel: number;
  key: number;
  velocity: number;
  /** MIDI program (patch) in force when the note started. */
  program: number;
  /** Seconds from the start of the effect. */
  start: number;
  duration: number;
  /** Pitch-wheel offset in semitones when the note started. */
  bend: number;
}

/** Notes of a format-0 SMF with one track, as built by `parseSx`. Returns [] for anything malformed. */
export function scheduleNotes(smf: Uint8Array): Note[] {
  const tag = (i: number) => String.fromCharCode(...smf.subarray(i, i + 4));
  if (smf.length < 22 || tag(0) !== 'MThd' || tag(14) !== 'MTrk') return [];
  const ppqn = (smf[12]! << 8) | smf[13]!;
  if (ppqn === 0 || ppqn & 0x8000) return [];
  const secondsPerTick = MICROS_PER_QUARTER / 1e6 / ppqn;
  const trackLen = ((smf[18]! << 24) | (smf[19]! << 16) | (smf[20]! << 8) | smf[21]!) >>> 0;
  const end = Math.min(smf.length, 22 + trackLen);

  const programs = new Map<number, number>();
  const bends = new Map<number, number>();
  const open = new Map<number, Note[]>();
  const notes: Note[] = [];
  let i = 22;
  let tick = 0;
  const byte = () => (i < end ? smf[i++]! : -1);
  while (i < end) {
    let delta = 0;
    let b = byte();
    for (let n = 0; n < 4; n++) {
      delta = (delta << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
      b = byte();
    }
    tick += delta;
    const status = byte();
    if (status < 0) break;
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (status === 0xff) break; // end of track
    if (kind === 0xc0) {
      programs.set(channel, byte());
    } else if (kind === 0x90 || kind === 0x80) {
      const key = byte();
      const velocity = byte();
      const now = tick * secondsPerTick;
      const id = channel * 128 + key;
      if (kind === 0x90 && velocity > 0) {
        const note: Note = {
          channel, key, velocity, program: programs.get(channel) ?? 0, start: now, duration: -1,
          bend: bends.get(channel) ?? 0,
        };
        notes.push(note);
        open.set(id, [...(open.get(id) ?? []), note]);
      } else {
        const stack = open.get(id);
        const note = stack?.shift();
        if (note) note.duration = Math.max(0.02, now - note.start);
      }
    } else if (kind === 0xe0) {
      const lo = byte();
      const hi = byte();
      bends.set(channel, ((((hi << 7) | lo) - 8192) / 8192) * 2);
    } else if (kind === 0xb0) {
      byte();
      byte();
    } else {
      break;
    }
  }
  const last = tick * secondsPerTick;
  // A note never released rings to the end of the stream.
  for (const n of notes) if (n.duration < 0) n.duration = Math.max(0.05, last - n.start);
  return notes.filter((n) => n.start < MAX_NOTE_SECONDS).map((n) => ({ ...n, duration: Math.min(n.duration, MAX_NOTE_SECONDS - n.start) }));
}

export function midiFrequency(key: number, bendSemitones = 0): number {
  return 440 * 2 ** ((key - 69 + bendSemitones) / 12);
}

export type WaveShape = 'sine' | 'triangle' | 'square' | 'sawtooth';

/** Rough General MIDI families: keys and bells soft, strings and brass bright, leads buzzy. */
export function waveFor(program: number): WaveShape {
  const family = Math.floor(program / 8);
  if (family === 0 || family === 1 || family === 5 || family === 14) return 'triangle';
  if (family === 2 || family === 3 || family === 7 || family === 9) return 'square';
  if (family === 4 || family === 6 || family === 8 || family === 10) return 'sawtooth';
  return 'sine';
}

export interface OscillatorLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}
export interface SynthContextLike {
  readonly currentTime: number;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorLike;
}

export interface SynthHandle {
  /** Seconds the effect lasts. */
  duration: number;
  stop(): void;
}

export class NoteSynth {
  constructor(private readonly ctx: SynthContextLike, private readonly output: unknown) {}

  /** Plays the notes of an SMF voice into the output; `onEnd` fires once after the last note. */
  play(smf: Uint8Array, onEnd?: () => void): SynthHandle | undefined {
    const notes = scheduleNotes(smf);
    if (!notes.length) return undefined;
    const t0 = this.ctx.currentTime + 0.01;
    const bus = this.ctx.createGain();
    bus.gain.value = 0.5 / Math.sqrt(notes.length > 4 ? notes.length / 2 : 2);
    bus.connect(this.output);
    const oscs: OscillatorLike[] = [];
    let duration = 0;
    let lastOsc = oscs[0];
    for (const n of notes) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = waveFor(n.program);
      osc.frequency.value = midiFrequency(n.key, n.bend);
      const peak = Math.max(0.05, n.velocity / 127);
      const on = t0 + n.start;
      const off = on + n.duration;
      env.gain.setValueAtTime(0, on);
      env.gain.linearRampToValueAtTime(peak, on + ATTACK);
      env.gain.setValueAtTime(peak, off);
      env.gain.linearRampToValueAtTime(0, off + RELEASE);
      osc.connect(env);
      env.connect(bus);
      osc.start(on);
      osc.stop(off + RELEASE);
      oscs.push(osc);
      if (n.start + n.duration + RELEASE >= duration) lastOsc = osc;
      duration = Math.max(duration, n.start + n.duration + RELEASE);
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      bus.disconnect();
      onEnd?.();
    };
    lastOsc!.onended = finish;
    return {
      duration,
      stop: () => {
        for (const o of oscs) {
          try {
            o.stop();
          } catch {
            // already stopped
          }
        }
        finish();
      },
    };
  }
}
