import { describe, expect, it, vi } from 'vitest';
import { MAX_VOICES, SfxPlayer, type SfxContextLike } from './sfx';
import { playSfx, setSfxHandler } from './sfxBus';
import { attackHitSound, Snd } from './soundIds';

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const chunk = (tag: string, body: number[]) => [...ascii(tag), ...u32(body.length), ...body];

/** An FRP.SX with one wave sound (id 60, "BUY"). */
function sxFile(): ArrayBuffer {
  const voice = [0xfe, 0, ...u16(8000), ...u32(3), 0, 0, 128, 255, 0];
  const dir = [1, 1, 0, ...u16(9), ...u16(voice.length), 0xff, 0xff];
  const body = [...dir, ...voice];
  const entry = chunk('SND:', [...u16(60), 1, 0, 0, ...u32(body.length + 2), 0, 0, ...body]);
  const tag = chunk('TAG:', [...u16(1), ...u16(60), ...ascii('BUY'), 0]);
  const inf = chunk('INF:', [0, 0, ...u16(1), 0, ...u16(60), ...u32(8 + 5 + 6 + tag.length)]);
  return Uint8Array.from([...inf, ...tag, ...entry]).buffer;
}

function fakeContext() {
  const sources: { started: number; stopped: number; onended: (() => void) | null; buffer: unknown }[] = [];
  const gain = () => ({ gain: { value: 1 } as never, connect: () => {}, disconnect: () => {} });
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createGain: gain,
    createBufferSource: () => {
      const s = {
        started: 0,
        stopped: 0,
        onended: null as (() => void) | null,
        buffer: null as unknown,
        loop: false,
        connect: () => {},
        disconnect: () => {},
        start() {
          s.started++;
        },
        stop() {
          s.stopped++;
        },
      };
      sources.push(s);
      return s;
    },
    createBuffer: (_c: number, length: number, rate: number) => ({
      length,
      rate,
      data: undefined as Float32Array | undefined,
      copyToChannel(d: Float32Array) {
        this.data = d;
      },
    }),
    resume: async () => {},
  };
  return { ctx: ctx as unknown as SfxContextLike, sources };
}

describe('SfxPlayer', () => {
  it('decodes a wave once and plays it each time', async () => {
    const { ctx, sources } = fakeContext();
    const fetchBytes = vi.fn(async () => sxFile());
    const p = new SfxPlayer({ context: ctx, fetchBytes });
    await p.play(60);
    await p.play(60);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(2);
    expect(sources[0]!.buffer).toBe(sources[1]!.buffer);
    expect(sources[0]!.started).toBe(1);
  });

  it('ignores unknown ids, mute, and a missing file', async () => {
    const { ctx, sources } = fakeContext();
    const p = new SfxPlayer({ context: ctx, fetchBytes: async () => sxFile() });
    await p.play(999);
    p.setMuted(true);
    await p.play(60);
    expect(sources).toHaveLength(0);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = new SfxPlayer({
      context: fakeContext().ctx,
      fetchBytes: async () => {
        throw new Error('nope');
      },
    });
    await expect(broken.play(60)).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('cuts the oldest voice beyond the polyphony limit', async () => {
    const { ctx, sources } = fakeContext();
    const p = new SfxPlayer({ context: ctx, fetchBytes: async () => sxFile() });
    for (let i = 0; i < MAX_VOICES + 1; i++) await p.play(60);
    expect(sources[0]!.stopped).toBe(1);
    expect(sources[1]!.stopped).toBe(0);
  });
});

describe('sfx bus and ids', () => {
  it('forwards to the handler, repeating, and is silent without one', () => {
    playSfx(1);
    const h = vi.fn();
    setSfxHandler(h);
    playSfx(5, 3);
    setSfxHandler(undefined);
    expect(h.mock.calls).toEqual([[5], [5], [5]]);
  });

  it('picks the melee hit sound by monster', () => {
    expect(attackHitSound(19)).toBe(Snd.fistHit);
    expect(attackHitSound(39)).toBe(Snd.zap);
    expect(attackHitSound(1)).toBe(Snd.swordHit);
  });
});
