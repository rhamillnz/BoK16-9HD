import { describe, expect, it } from 'vitest';
import {
  MusicPlayer,
  isValidSongId,
  songUrl,
  type AudioContextLike,
  type AudioParamLike,
  type GainNodeLike,
  type GestureTarget,
  type SourceNodeLike,
} from '../src/audio/music';

class FakeParam implements AudioParamLike {
  value = 1;
  ramps: Array<[number, number]> = [];
  sets: Array<[number, number]> = [];
  cancelled = 0;
  cancelScheduledValues() {
    this.cancelled++;
  }
  setValueAtTime(v: number, t: number) {
    this.sets.push([v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.ramps.push([v, t]);
  }
}
class FakeGain implements GainNodeLike {
  gain = new FakeParam();
  connected: unknown = null;
  disconnected = false;
  connect(d: unknown) {
    this.connected = d;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class FakeSource implements SourceNodeLike {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  disconnected = false;
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  start(t = 0) {
    this.startedAt = t;
  }
  stop(t = 0) {
    this.stoppedAt = t;
  }
}
class FakeContext implements AudioContextLike {
  currentTime = 10;
  state = 'running';
  destination = { dest: true };
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  resumed = 0;
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async resume() {
    this.resumed++;
    this.state = 'running';
  }
}

function setup(state = 'running', gestureTarget?: GestureTarget) {
  const context = new FakeContext();
  context.state = state;
  const fetched: string[] = [];
  const player = new MusicPlayer(
    {
      context,
      fetchBytes: async (url) => {
        fetched.push(url);
        return new ArrayBuffer(4);
      },
      decode: async () => ({ decoded: true }),
      gestureTarget,
    },
    { volume: 0.8 },
  );
  return { context, fetched, player };
}

describe('song ids', () => {
  it('formats urls and validates range', () => {
    expect(songUrl(2)).toBe('/bak/music/bak02.ogg');
    expect(songUrl(63)).toBe('/bak/music/bak63.ogg');
    expect(isValidSongId(1)).toBe(false);
    expect(isValidSongId(2)).toBe(true);
    expect(isValidSongId(64)).toBe(false);
    expect(isValidSongId(2.5)).toBe(false);
  });
});

describe('MusicPlayer', () => {
  it('plays a looping song with a fade-in', async () => {
    const { context, fetched, player } = setup();
    await player.play(5);
    expect(fetched).toEqual(['/bak/music/bak05.ogg']);
    const src = context.sources[0]!;
    expect(src.loop).toBe(true);
    expect(src.startedAt).toBe(10);
    expect(context.gains[1]!.gain.ramps).toEqual([[1, 12]]);
    expect(player.songId).toBe(5);
  });

  it('plays a sting once, then brings back the song it replaced', async () => {
    const { context, player } = setup();
    await player.play(2);
    await player.play(30, true);
    const sting = context.sources[1]!;
    expect(sting.loop).toBe(false);
    expect(player.songId).toBe(30);
    // A second sting during the first still returns to the zone song.
    await player.play(31, true);
    context.sources[2]!.onended!();
    await Promise.resolve();
    await Promise.resolve();
    expect(player.songId).toBe(2);
    expect(context.sources[3]!.loop).toBe(true);
  });

  it('a song started during a sting cancels the return', async () => {
    const { context, player } = setup();
    await player.play(2);
    await player.play(30, true);
    await player.play(7);
    context.sources[1]!.onended!();
    expect(player.songId).toBe(7);
    expect(context.sources).toHaveLength(3);
  });

  it('crossfades over two seconds and stops the old voice', async () => {
    const { context, player } = setup();
    await player.play(5);
    context.currentTime = 20;
    await player.play(6);
    const [old, next] = context.sources;
    expect(next!.startedAt).toBe(20);
    expect(old!.stoppedAt).toBe(22);
    expect(context.gains[1]!.gain.ramps.at(-1)).toEqual([0, 22]);
    old!.onended?.();
    expect(old!.disconnected).toBe(true);
    expect(player.songId).toBe(6);
  });

  it('ignores replaying the current song and caches decoded buffers', async () => {
    const { context, fetched, player } = setup();
    await player.play(5);
    await player.play(5);
    expect(context.sources).toHaveLength(1);
    await player.play(6);
    await player.play(5);
    expect(fetched).toEqual(['/bak/music/bak05.ogg', '/bak/music/bak06.ogg']);
  });

  it('drops a play superseded while loading', async () => {
    const { context, player } = setup();
    const a = player.play(5);
    const b = player.play(6);
    await Promise.all([a, b]);
    expect(context.sources).toHaveLength(1);
    expect(player.songId).toBe(6);
  });

  it('rejects invalid ids and recovers from fetch failure', async () => {
    const context = new FakeContext();
    let fail = true;
    const player = new MusicPlayer({
      context,
      fetchBytes: async () => {
        if (fail) throw new Error('404');
        return new ArrayBuffer(1);
      },
      decode: async () => ({}),
    });
    await expect(player.play(1)).rejects.toThrow(RangeError);
    await expect(player.play(5)).rejects.toThrow('404');
    fail = false;
    await player.play(5);
    expect(player.songId).toBe(5);
  });

  it('stop fades out the current song', async () => {
    const { context, player } = setup();
    await player.play(5);
    player.stop();
    expect(context.sources[0]!.stoppedAt).toBe(12);
    expect(player.songId).toBeNull();
  });

  it('handles volume and mute on the master gain', () => {
    const { context, player } = setup();
    const master = context.gains[0]!;
    expect(master.gain.value).toBe(0.8);
    player.setVolume(2);
    expect(master.gain.value).toBe(1);
    player.setMuted(true);
    expect(master.gain.value).toBe(0);
    player.setVolume(0.3);
    expect(master.gain.value).toBe(0);
    expect(player.toggleMute()).toBe(false);
    expect(master.gain.value).toBe(0.3);
  });

  it('resumes a suspended context on the first user gesture only', () => {
    const handlers = new Map<string, () => void>();
    const target: GestureTarget = {
      addEventListener: (t, l) => void handlers.set(t, l),
      removeEventListener: (t) => void handlers.delete(t),
    };
    const { context } = setup('suspended', target);
    expect(handlers.size).toBeGreaterThan(0);
    handlers.get('keydown')!();
    expect(context.resumed).toBe(1);
    expect(handlers.size).toBe(0);
  });

  it('does not listen for gestures when already running', () => {
    const handlers = new Map<string, () => void>();
    setup('running', {
      addEventListener: (t, l) => void handlers.set(t, l),
      removeEventListener: () => {},
    });
    expect(handlers.size).toBe(0);
  });
});
