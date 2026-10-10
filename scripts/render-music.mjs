// Render the game's own song data (FRP.SX) to audio with FluidSynth and a General MIDI / GS SoundFont.
// The output is derived from the original game data, so it goes to the gitignored art/derived/music/.
//
// Usage: node scripts/render-music.mjs --soundfont <file.sf2> [--fluidsynth <exe>] [--selector 12]
//          [--bpm 120] [--songs 3,16] [--out art/derived/music/gs]
//   --selector picks the sound-card version inside each song (FRP.SX keeps several); --bpm sets the
//   tempo of the note data's 32 ticks per quarter note. Writes bakNN.ogg named like the GOG files.
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const soundfont = args.soundfont;
if (!soundfont) {
  console.error('usage: node scripts/render-music.mjs --soundfont <file.sf2> [--selector N] [--bpm N] [--songs 3,16]');
  process.exit(1);
}
const fluidsynth = args.fluidsynth ?? 'fluidsynth';
const selector = Number(args.selector ?? 12);
const bpm = Number(args.bpm ?? 120);
const out = path.resolve(args.out ?? 'art/derived/music/gs');
const only = args.songs ? new Set(args.songs.split(',').map(Number)) : undefined;

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { parseSx } = await server.ssrLoadModule('/src/formats/sx.ts');
const { BAK_DIR } = await server.ssrLoadModule('/vite.config.ts');
await server.close();

const sx = parseSx(new Uint8Array(readFileSync(path.join(BAK_DIR, 'FRP.SX'))));
mkdirSync(out, { recursive: true });
const tmp = path.join(out, '_tmp');
mkdirSync(tmp, { recursive: true });

const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
/** One format-1 file: a tempo track, then the MTrk chunk of every voice's one-track file. */
function mergeVoices(voices) {
  const micros = Math.round(60e6 / bpm);
  const tempo = [0x00, 0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff, 0x00, 0xff, 0x2f, 0x00];
  const chunks = [[...ascii('MTrk'), ...u32(tempo.length), ...tempo]];
  for (const v of voices) chunks.push([...v.smf.subarray(14)]); // skip the 14-byte header: MTrk chunk follows
  return Uint8Array.from([...ascii('MThd'), ...u32(6), 0, 1, 0, chunks.length, 0, 32, ...chunks.flat()]);
}

let done = 0;
for (const [id, entry] of sx.entries) {
  const file = id - 999; // sound 1000 + N is bak(N+1).ogg, see src/audio/songs.ts
  if (id <= 1000 || (only && !only.has(file))) continue;
  const sound = entry.sounds.find((s) => s.selector === selector);
  const voices = (sound?.voices ?? []).filter((v) => v.kind === 'midi');
  if (!voices.length) continue;
  const name = `bak${String(file).padStart(2, '0')}`;
  const mid = path.join(tmp, `${name}.mid`);
  const wav = path.join(tmp, `${name}.wav`);
  writeFileSync(mid, mergeVoices(voices));
  execFileSync(fluidsynth, ['-ni', '-q', '-g', '0.6', '-r', '44100', '-F', wav, soundfont, mid], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', 'areverse,silenceremove=start_periods=1:start_threshold=-60dB,areverse', '-c:a', 'libvorbis', '-q:a', '5', path.join(out, `${name}.ogg`)]);
  done++;
  console.log(`${name} ${entry.name}`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`${done} songs rendered to ${out}`);
