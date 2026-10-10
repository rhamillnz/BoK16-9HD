/**
 * Music browser (dev only, /music.html): every track of the soundtrack with where the original uses
 * it, a player for the recording (bakNN.ogg) and for the game's own note version (FRP.SX, synthesised),
 * and a notes box per track saved by the dev server to docs/music-notes.json.
 */
import { ResourceArchive } from '../formats/archive';
import { MAX_SONG_ID, MIN_SONG_ID, songUrl } from '../audio/music';
import { createBrowserSfxPlayer } from '../audio/sfx';
import { SOUND_INDEX_BASE } from '../audio/songs';
import { songUses, type SongUse } from '../audio/musicUsage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLDivElement>('status');
const list = $<HTMLElement>('list');
const player = $<HTMLAudioElement>('player');
const nowLabel = $<HTMLSpanElement>('nowLabel');
const filter = $<HTMLSelectElement>('filter');
const search = $<HTMLInputElement>('search');

const fetchBytes = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e: HTMLElement = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e as HTMLElementTagNameMap[K];
}

const KIND_LABEL: Record<SongUse['kind'], string> = {
  dialogue: 'Dialogue',
  cutscene: 'Cutscene',
  scene: 'Building',
  fixed: 'Original',
  remake: 'Remake',
};

/** The original's sound number for a track: file bakNN.ogg holds sound 1000 + NN - 1 (see songs.ts). */
const soundIndex = (n: number) => SOUND_INDEX_BASE + n - 1;

let notes: Record<string, string> = {};
let saveTimer: number | undefined;
const saveNotes = (mark: HTMLElement) => {
  mark.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    const clean = Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim()));
    const res = await fetch('/api/music-notes', { method: 'POST', body: JSON.stringify(clean) }).catch(() => undefined);
    mark.textContent = res?.ok ? 'Saved to docs/music-notes.json' : 'Could not save: is the dev server running?';
  }, 600);
};

const synth = createBrowserSfxPlayer(0.8);
let playingRow: HTMLElement | undefined;
const markPlaying = (row: HTMLElement | undefined) => {
  playingRow?.classList.remove('playing');
  playingRow = row;
  row?.classList.add('playing');
};

function useList(uses: SongUse[]): HTMLElement {
  if (!uses.length) return el('p', { className: 'unused' }, 'Not used anywhere in the original data we can read.');
  const ul = el('ul', { className: 'uses' });
  const dialogue = uses.filter((u) => u.kind === 'dialogue');
  for (const u of uses.filter((u) => u.kind !== 'dialogue'))
    ul.append(el('li', {}, el('span', { className: `tag ${u.kind}` }, KIND_LABEL[u.kind]), ' ', u.where));
  if (dialogue.length) {
    const files = [...new Set(dialogue.map((u) => u.where.replace(/\.DDX$/i, '')))].join(', ');
    const inner = el('ul', { className: 'uses' });
    const silent = dialogue.filter((u) => !u.detail);
    for (const u of dialogue) if (u.detail) inner.append(el('li', {}, `${u.where}: “${u.detail}”`));
    if (silent.length)
      inner.append(
        el(
          'li',
          {},
          `…and ${silent.length} step${silent.length > 1 ? 's' : ''} with no text (${[...new Set(silent.map((u) => u.where))].join(', ')})`,
        ),
      );
    ul.append(
      el(
        'li',
        {},
        el(
          'details',
          {},
          el(
            'summary',
            {},
            el('span', { className: 'tag dialogue' }, KIND_LABEL.dialogue),
            ` cue in ${dialogue.length} dialogue step${dialogue.length > 1 ? 's' : ''} (${files})`,
          ),
          inner,
        ),
      ),
    );
  }
  return ul;
}

function trackRow(n: number, uses: SongUse[]): HTMLElement {
  const row = el('section', { className: 'track' });
  row.dataset.song = String(n);
  const length = el('small', {}, '…');
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.src = songUrl(n);
  probe.onloadedmetadata = () => {
    const s = Math.round(probe.duration);
    length.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    probe.src = '';
  };

  const play = el('button', { title: 'The recording (GOG music file)' }, '▶ Recording');
  play.onclick = () => {
    synth.stopAll();
    player.src = songUrl(n);
    void player.play();
    nowLabel.textContent = `Track ${n} (bak${String(n).padStart(2, '0')}.ogg)`;
    markPlaying(row);
  };
  const notesBtn = el('button', { title: "The game's own note data (FRP.SX), on the simple synth" }, '♪ Note version');
  notesBtn.onclick = () => {
    player.pause();
    synth.stopAll();
    void synth.play(soundIndex(n));
    nowLabel.textContent = `Track ${n}: note version (sound ${soundIndex(n)})`;
    markPlaying(row);
  };
  const stop = el('button', {}, '■');
  stop.onclick = () => {
    player.pause();
    synth.stopAll();
    markPlaying(undefined);
  };

  const id = el(
    'div',
    { className: 'id' },
    String(n),
    el('small', {}, `sound ${soundIndex(n)}`),
    length,
    el('div', { className: 'btns' }, play, notesBtn, stop),
  );

  const mark = el('div', { className: 'saved' });
  const box = el('textarea', {
    placeholder: 'Your notes on this track (mood, where it should play, keep or drop…)',
    value: notes[n] ?? '',
  });
  box.oninput = () => {
    notes[n] = box.value;
    row.dataset.noted = box.value.trim() ? '1' : '';
    saveNotes(mark);
  };
  row.dataset.noted = box.value.trim() ? '1' : '';
  row.dataset.kinds = [...new Set(uses.map((u) => u.kind))].join(' ');
  row.dataset.text = uses
    .map((u) => `${u.where} ${u.detail ?? ''}`)
    .join(' ')
    .toLowerCase();

  row.append(id, useList(uses), el('div', {}, box, mark));
  return row;
}

function applyFilter(): void {
  const f = filter.value;
  const q = search.value.trim().toLowerCase();
  for (const row of list.querySelectorAll<HTMLElement>('.track')) {
    const kinds = row.dataset.kinds ?? '';
    const original = kinds.split(' ').some((k) => k && k !== 'remake');
    const show =
      (f === 'all' ||
        (f === 'dialogue' && kinds.includes('dialogue')) ||
        (f === 'cutscene' && kinds.includes('cutscene')) ||
        (f === 'unused' && !original) ||
        (f === 'noted' && row.dataset.noted === '1')) &&
      (!q || row.dataset.text!.includes(q) || (notes[row.dataset.song!] ?? '').toLowerCase().includes(q));
    row.hidden = !show;
  }
}
filter.onchange = applyFilter;
search.oninput = applyFilter;
player.onended = () => markPlaying(undefined);

async function main(): Promise<void> {
  notes = await fetch('/api/music-notes')
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
    .catch(() => ({}));
  const [rmf, data] = await Promise.all([fetchBytes('/bak/KRONDOR.RMF'), fetchBytes('/bak/KRONDOR.001')]);
  const uses = songUses(new ResourceArchive(rmf, data));
  for (let n = MIN_SONG_ID; n <= MAX_SONG_ID; n++) list.append(trackRow(n, uses.get(n) ?? []));
  status.textContent =
    '62 tracks. "Recording" plays the GOG music file; "Note version" plays the game\'s own notes for it on a simple synth. Notes save as you type.';
  applyFilter();
}

main().catch((err: Error) => {
  status.textContent = `Could not read the game data: ${err.message}`;
});
