import { firstWave, parseSx, waveToFloat, type SxFile } from '../formats/sx';
import type { AudioContextLike, GainNodeLike, GestureTarget, SourceNodeLike } from './music';

export const SFX_URL = '/bak/frp.sx';
/** Effects playing at once; the oldest is cut when a new one would exceed this. */
export const MAX_VOICES = 8;

export interface SfxContextLike extends AudioContextLike {
  createBuffer(channels: number, length: number, sampleRate: number): { copyToChannel(data: Float32Array, channel: number): void };
}

export interface SfxDeps {
  context: SfxContextLike;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  gestureTarget?: GestureTarget;
}

interface Playing {
  source: SourceNodeLike;
}

/** Plays the sampled effects of FRP.SX. Note-only (MIDI) effects have no synth here and are skipped. */
export class SfxPlayer {
  private readonly ctx: SfxContextLike;
  private readonly master: GainNodeLike;
  private file: Promise<SxFile | undefined> | undefined;
  private readonly buffers = new Map<number, unknown | null>();
  private readonly playing: Playing[] = [];
  private vol: number;
  private muted = false;

  constructor(private readonly deps: SfxDeps, volume = 1) {
    this.ctx = deps.context;
    this.vol = Math.min(1, Math.max(0, volume));
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(this.ctx.destination);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setVolume(v: number): void {
    this.vol = Math.min(1, Math.max(0, v));
    this.applyMaster();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Load FRP.SX ahead of the first effect. Resolves to the warnings, or undefined when it cannot be loaded. */
  preload(): Promise<SxFile | undefined> {
    this.file ??= this.deps.fetchBytes(SFX_URL).then(
      (bytes) => {
        const sx = parseSx(new Uint8Array(bytes));
        if (sx.warnings.length) console.warn('FRP.SX:', sx.warnings);
        return sx;
      },
      (err) => {
        console.warn('Sound effects unavailable:', err);
        return undefined;
      },
    );
    return this.file;
  }

  async play(soundId: number): Promise<void> {
    if (this.muted) return;
    const sx = await this.preload();
    if (!sx) return;
    const buffer = this.bufferFor(sx, soundId);
    if (!buffer) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();

    while (this.playing.length >= MAX_VOICES) this.playing.shift()!.source.stop();
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    const voice = { source };
    this.playing.push(voice);
    source.onended = () => {
      const i = this.playing.indexOf(voice);
      if (i >= 0) this.playing.splice(i, 1);
      source.disconnect();
    };
    source.start();
  }

  private bufferFor(sx: SxFile, soundId: number): unknown | undefined {
    if (this.buffers.has(soundId)) return this.buffers.get(soundId) ?? undefined;
    const entry = sx.entries.get(soundId);
    const wave = entry && firstWave(entry);
    let buffer: unknown | null = null;
    if (wave && wave.samples.length > 0) {
      const b = this.ctx.createBuffer(1, wave.samples.length, wave.rate);
      b.copyToChannel(waveToFloat(wave.samples), 0);
      buffer = b;
    }
    this.buffers.set(soundId, buffer);
    return buffer ?? undefined;
  }

  private applyMaster(): void {
    this.master.gain.value = this.muted ? 0 : this.vol;
  }
}

export function createBrowserSfxPlayer(volume?: number): SfxPlayer {
  const context = new AudioContext();
  return new SfxPlayer(
    {
      context: context as unknown as SfxContextLike,
      fetchBytes: async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        return res.arrayBuffer();
      },
    },
    volume,
  );
}
