/**
 * WebAudio player for the original soundtrack, served by the dev server as
 * /bak/music/bakNN.ogg (NN = 02..63). Everything environment-specific
 * (AudioContext, fetch, decode) is injected so the logic is unit-testable.
 */

export const MIN_SONG_ID = 2;
export const MAX_SONG_ID = 63;
export const CROSSFADE_SECONDS = 2;

export function songUrl(songId: number): string {
  return `/bak/music/bak${String(songId).padStart(2, '0')}.ogg`;
}

export function isValidSongId(songId: number): boolean {
  return Number.isInteger(songId) && songId >= MIN_SONG_ID && songId <= MAX_SONG_ID;
}

// Minimal structural slices of the WebAudio API that the player uses.
export interface AudioParamLike {
  value: number;
  cancelScheduledValues(time: number): unknown;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
}
export interface AudioNodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}
export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}
export interface SourceNodeLike extends AudioNodeLike {
  buffer: unknown;
  loop: boolean;
  start(when?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  createGain(): GainNodeLike;
  createBufferSource(): SourceNodeLike;
  resume(): Promise<void>;
}

/** Where to listen for the first user gesture (document in a browser). */
export interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface MusicDeps {
  context: AudioContextLike;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  decode(bytes: ArrayBuffer): Promise<unknown>;
  gestureTarget?: GestureTarget;
}

export interface MusicOptions {
  volume?: number;
  crossfadeSeconds?: number;
}

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/** loop: until told otherwise; once: a dialogue sting, then back to what it replaced; rotation: see playRotation. */
export type PlayMode = 'loop' | 'once' | 'rotation';

interface Voice {
  songId: number;
  mode: PlayMode;
  source: SourceNodeLike;
  gain: GainNodeLike;
}

export class MusicPlayer {
  private readonly ctx: AudioContextLike;
  private readonly deps: MusicDeps;
  private readonly master: GainNodeLike;
  private readonly crossfade: number;
  private readonly cache = new Map<number, Promise<unknown>>();
  private current: Voice | null = null;
  private requested: number | null = null;
  /** What to go back to when a song played once (a dialogue sting) ends. */
  private returnTo: number | 'rotation' | null = null;
  private rotation: { songs: readonly number[]; next: number } | null = null;
  private vol: number;
  private muted = false;
  private gestureCleanup: (() => void) | null = null;

  constructor(deps: MusicDeps, options: MusicOptions = {}) {
    this.deps = deps;
    this.ctx = deps.context;
    this.vol = clamp01(options.volume ?? 1);
    this.crossfade = options.crossfadeSeconds ?? CROSSFADE_SECONDS;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(this.ctx.destination);
    this.armGestureResume();
  }

  get songId(): number | null {
    return this.current?.songId ?? null;
  }
  get volume(): number {
    return this.vol;
  }
  get isMuted(): boolean {
    return this.muted;
  }

  /** True while the exploring rotation is playing (or will resume after a sting). */
  get rotating(): boolean {
    return this.current?.mode === 'rotation' || this.returnTo === 'rotation';
  }

  /**
   * Play `songs` one after another, each once, wrapping round, starting at index `start`. A dialogue
   * sting in between returns to the rotation. No-op when this list is already rotating.
   */
  playRotation(songs: readonly number[], start = 0): Promise<void> {
    const r = this.rotation;
    if (this.rotating && r && r.songs.length === songs.length && r.songs.every((s, i) => s === songs[i]))
      return Promise.resolve();
    this.rotation = { songs: [...songs], next: start };
    return this.advance();
  }

  /** Go on with the rotation after something else (a cutscene) had the music. */
  resumeRotation(): Promise<void> {
    return this.rotation ? this.advance() : Promise.resolve();
  }

  private advance(): Promise<void> {
    const r = this.rotation!;
    const song = r.songs[r.next % r.songs.length]!;
    r.next = (r.next + 1) % r.songs.length;
    return this.play(song, 'rotation');
  }

  /**
   * Start a song, crossfading from the current one. No-op if already playing it. `once` (a dialogue
   * sting) plays through a single time and then the song or rotation it replaced comes back.
   */
  async play(songId: number, mode: PlayMode | boolean = 'loop'): Promise<void> {
    if (mode === true) mode = 'once';
    else if (mode === false) mode = 'loop';
    if (!isValidSongId(songId)) throw new RangeError(`Invalid song id ${songId}`);
    if (this.requested === songId) return;
    const back =
      mode === 'once'
        ? (this.returnTo ?? (this.current?.mode === 'rotation' ? 'rotation' : (this.current?.songId ?? null)))
        : null;
    this.requested = songId;

    let buffer: unknown;
    try {
      buffer = await this.load(songId);
    } catch (err) {
      this.cache.delete(songId);
      if (this.requested === songId) this.requested = this.current?.songId ?? null;
      throw err;
    }
    // A newer play()/stop() call superseded this one while loading.
    if (this.requested !== songId) return;
    this.returnTo = back;

    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + this.crossfade);
    gain.connect(this.master);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = mode === 'loop';
    source.connect(gain);
    source.start(now);
    if (mode !== 'loop') {
      const ended = mode;
      // A crossfade to another song replaces this handler (fadeOut), so this runs only on a natural end.
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (this.current?.source !== source) return;
        this.current = null;
        this.requested = null;
        const to = ended === 'rotation' ? 'rotation' : this.returnTo;
        this.returnTo = null;
        const next = to === 'rotation' ? this.resumeRotation() : to !== null ? this.play(to) : undefined;
        void next?.catch((err) => console.warn('Music unavailable:', err));
      };
    }

    const old = this.current;
    this.current = { songId, mode, source, gain };
    if (old) this.fadeOut(old, now);
  }

  /** Fade out and stop the current song. */
  stop(): void {
    this.requested = null;
    this.returnTo = null;
    const old = this.current;
    this.current = null;
    if (old) this.fadeOut(old, this.ctx.currentTime);
  }

  setVolume(volume: number): void {
    this.vol = clamp01(volume);
    this.applyMaster();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Resume a suspended context (browsers require a user gesture first). */
  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  dispose(): void {
    this.stop();
    this.gestureCleanup?.();
    this.master.disconnect();
  }

  private applyMaster(): void {
    this.master.gain.value = this.muted ? 0 : this.vol;
  }

  private load(songId: number): Promise<unknown> {
    let p = this.cache.get(songId);
    if (!p) {
      p = this.deps.fetchBytes(songUrl(songId)).then((bytes) => this.deps.decode(bytes));
      this.cache.set(songId, p);
    }
    return p;
  }

  private fadeOut(voice: Voice, now: number): void {
    const end = now + this.crossfade;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.linearRampToValueAtTime(0, end);
    voice.source.stop(end);
    voice.source.onended = () => {
      voice.source.disconnect();
      voice.gain.disconnect();
    };
  }

  private armGestureResume(): void {
    const target = this.deps.gestureTarget;
    if (!target || this.ctx.state !== 'suspended') return;
    const handler = () => {
      cleanup();
      void this.ctx.resume();
    };
    const cleanup = () => {
      for (const type of GESTURE_EVENTS) target.removeEventListener(type, handler);
      this.gestureCleanup = null;
    };
    for (const type of GESTURE_EVENTS) target.addEventListener(type, handler);
    this.gestureCleanup = cleanup;
  }
}

/** Build a MusicPlayer on the browser's AudioContext, fetch and document. */
export function createBrowserMusicPlayer(options?: MusicOptions): MusicPlayer {
  const context = new AudioContext();
  return new MusicPlayer(
    {
      context: context as unknown as AudioContextLike,
      // Prefer the GS render of a song (scripts/render-music.mjs, served by the dev server) over the GOG file.
      fetchBytes: async (url) => {
        const gs = url.replace('/bak/music/', '/derived-music/gs/');
        if (gs !== url) {
          const res = await fetch(gs).catch(() => undefined);
          if (res?.ok && !res.headers.get('content-type')?.includes('text/html')) return res.arrayBuffer();
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        return res.arrayBuffer();
      },
      decode: (bytes) => context.decodeAudioData(bytes),
      gestureTarget: document,
    },
    options,
  );
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
