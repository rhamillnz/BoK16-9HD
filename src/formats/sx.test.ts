import { describe, expect, it } from 'vitest';
import { firstWave, parseSx, waveToFloat } from './sx';

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const chunk = (tag: string, body: number[]) => [...ascii(tag), ...u32(body.length), ...body];

/** Voice: code, 1 unknown byte, rate, size, 2 unknown bytes, samples. */
const waveVoice = (rate: number, samples: number[]) => [
  0xfe,
  0,
  ...u16(rate),
  ...u32(samples.length),
  0,
  0,
  ...samples,
];
/** Voice on channel 3: code, 1 unknown byte, then { delta, [status], data } events, 0xFC. */
const midiVoice = (events: number[]) => [0x93, 0, ...events, 0, 0xfc];

/** One sound with the given voices: a directory then the voice data. */
function entry(id: number, type: number, voices: number[][]): number[] {
  const dirLength = 1 + voices.length * 6 + 2;
  const dir: number[] = [7]; // selector
  const data: number[] = [];
  for (const v of voices) {
    dir.push(1, 0, ...u16(dirLength + data.length), ...u16(v.length));
    data.push(...v);
  }
  dir.push(0xff, 0xff);
  const body = [...dir, ...data];
  return chunk('SND:', [...u16(id), type, 0, 0, ...u32(body.length + 2), 0, 0, ...body]);
}

function build(entries: { id: number; name: string; type: number; voices: number[][] }[]): Uint8Array {
  const parts: number[][] = entries.map((e) => entry(e.id, e.type, e.voices));
  const tag = chunk('TAG:', [...u16(entries.length), ...entries.flatMap((e) => [...u16(e.id), ...ascii(e.name), 0])]);
  const infLen = 8 + 5 + entries.length * 6;
  const tagLen = tag.length;
  let offset = infLen + tagLen;
  const inf = [0, 0, ...u16(entries.length), 0];
  parts.forEach((p, i) => {
    inf.push(...u16(entries[i]!.id), ...u32(offset));
    offset += p.length;
  });
  return Uint8Array.from([...chunk('INF:', inf), ...tag, ...parts.flat()]);
}

describe('parseSx', () => {
  const file = build([
    { id: 12, name: 'TELEPORT', type: 1, voices: [waveVoice(11025, [128, 255, 0, 128])] },
    // note on 60 vel 100 at tick 0, 300 ticks later (0xF8 + 60) velocity-0 note on, then a patch change
    { id: 65, name: 'HIT', type: 2, voices: [midiVoice([0, 0x93, 60, 100, 0xf8, 60, 60, 0, 0, 0xc3, 5])] },
  ]);

  it('reads names, types and wave samples', () => {
    const sx = parseSx(file);
    expect(sx.warnings).toEqual([]);
    const e = sx.entries.get(12)!;
    expect(e.name).toBe('TELEPORT');
    expect(e.type).toBe(1);
    const w = firstWave(e)!;
    expect(w.rate).toBe(11025);
    expect([...w.samples]).toEqual([128, 255, 0, 128]);
    expect([...waveToFloat(w.samples)]).toEqual([0, 127 / 128, -1, 0]);
  });

  it('turns note voices into a standard midi file', () => {
    const e = parseSx(file).entries.get(65)!;
    expect(firstWave(e)).toBeUndefined();
    const v = e.sounds[0]!.voices[0]!;
    if (v.kind !== 'midi') throw new Error('expected midi');
    expect(v.channel).toBe(3);
    const text = String.fromCharCode(...v.smf.subarray(0, 4));
    expect(text).toBe('MThd');
    const track = [...v.smf.subarray(22)];
    // note on, 300 ticks (0x82 0x2c) later a note off (velocity 0), then the patch change at the same tick
    expect(track).toEqual([0, 0x93, 60, 100, 0x82, 0x2c, 0x83, 60, 0, 0, 0xc3, 5, 0, 0xff, 0x2f, 0]);
  });

  it('skips entries it cannot read and reports them', () => {
    // Cut the file inside the second entry's voice data: the first entry survives.
    const sx = parseSx(file.subarray(0, file.length - 6));
    expect(sx.entries.has(12)).toBe(true);
    expect(sx.warnings.length).toBe(1);
  });
});
