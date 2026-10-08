import { ResourceArchive } from '../formats/archive';
import { parseBMX, toRGBA } from '../formats/bmx';
import { parsePalette, type Palette } from '../formats/palette';
import { guessPalette } from '../data/palettes';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const listEl = $<HTMLElement>('list');
const viewEl = $<HTMLElement>('view');
const filterEl = $<HTMLInputElement>('filter');
const paletteEl = $<HTMLSelectElement>('palette');
const scaleEl = $<HTMLSelectElement>('scale');
const statusEl = $<HTMLElement>('status');
const loaderEl = $<HTMLElement>('loader');
const folderEl = $<HTMLInputElement>('folder');

let archive: ResourceArchive | undefined;
let selected: string | undefined;
const AUTO = '(auto)';

async function loadFromDevServer(): Promise<ResourceArchive | undefined> {
  const [rmf, data] = await Promise.all([fetch('/bak/KRONDOR.RMF'), fetch('/bak/KRONDOR.001')]);
  if (!rmf.ok || !data.ok) return undefined;
  return new ResourceArchive(new Uint8Array(await rmf.arrayBuffer()), new Uint8Array(await data.arrayBuffer()));
}

async function loadFromFolder(files: FileList): Promise<ResourceArchive> {
  const find = (n: string) => [...files].find((f) => f.name.toUpperCase() === n);
  const rmf = find('KRONDOR.RMF');
  const data = find('KRONDOR.001');
  if (!rmf || !data) throw new Error('KRONDOR.RMF / KRONDOR.001 not found in that folder');
  return new ResourceArchive(new Uint8Array(await rmf.arrayBuffer()), new Uint8Array(await data.arrayBuffer()));
}

function setArchive(a: ResourceArchive) {
  archive = a;
  loaderEl.hidden = true;
  statusEl.textContent = `${a.entries.length} resources`;
  paletteEl.replaceChildren(
    new Option(AUTO),
    ...a.entries.filter((e) => e.name.endsWith('.PAL')).map((e) => new Option(e.name)),
  );
  const fromHash = decodeURIComponent(location.hash.slice(1));
  renderList();
  if (fromHash && a.has(fromHash)) select(fromHash);
}

function renderList() {
  if (!archive) return;
  const q = filterEl.value.trim().toUpperCase();
  const items = archive.entries.filter((e) => !q || e.name.includes(q));
  listEl.replaceChildren(
    ...items.map((e) => {
      const b = document.createElement('button');
      b.dataset.name = e.name;
      b.setAttribute('aria-current', String(e.name === selected));
      b.innerHTML = `${e.name}<span>${(e.size / 1024).toFixed(1)}k</span>`;
      b.onclick = () => select(e.name);
      return b;
    }),
  );
}

function select(name: string) {
  selected = name;
  history.replaceState(null, '', `#${encodeURIComponent(name)}`);
  for (const b of listEl.querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.name === name));
  render();
}

function currentPalette(imageName: string): { name: string; pal: Palette } {
  const a = archive!;
  const name =
    paletteEl.value === AUTO
      ? guessPalette(
          imageName,
          a.entries.map((e) => e.name),
        )
      : paletteEl.value;
  return { name, pal: parsePalette(a.get(name)) };
}

function render() {
  if (!archive || !selected) return;
  const bytes = archive.get(selected);
  const head = document.createElement('h2');
  head.textContent = selected;
  try {
    if (selected.endsWith('.BMX')) renderImages(head, bytes);
    else if (selected.endsWith('.PAL')) renderPalette(head, bytes);
    else renderHex(head, bytes);
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = `Failed to decode: ${(err as Error).message}`;
    viewEl.replaceChildren(head, p);
    renderHex(head, bytes, true);
  }
}

function renderImages(head: HTMLElement, bytes: Uint8Array) {
  const images = parseBMX(bytes);
  const { name: palName, pal } = currentPalette(selected!);
  head.textContent += ` — ${images.length} image(s), palette ${palName}`;
  const scale = Number(scaleEl.value);
  const grid = document.createElement('div');
  grid.className = 'grid';
  images.forEach((img, i) => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.style.width = `${img.width * scale}px`;
    c.style.height = `${img.height * scale}px`;
    c.getContext('2d')!.putImageData(new ImageData(toRGBA(img, pal), img.width, img.height), 0, 0);
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = `#${i} ${img.width}×${img.height}`;
    fig.append(c, cap);
    grid.append(fig);
  });
  viewEl.replaceChildren(head, grid);
}

function renderPalette(head: HTMLElement, bytes: Uint8Array) {
  const pal = parsePalette(bytes);
  const sw = document.createElement('div');
  sw.className = 'swatches';
  for (let i = 0; i < 256; i++) {
    const d = document.createElement('div');
    d.style.background = `rgb(${pal[i * 4]},${pal[i * 4 + 1]},${pal[i * 4 + 2]})`;
    d.title = `${i}`;
    sw.append(d);
  }
  viewEl.replaceChildren(head, sw);
}

function renderHex(head: HTMLElement, bytes: Uint8Array, append = false) {
  const n = Math.min(bytes.length, 1024);
  const lines: string[] = [];
  for (let off = 0; off < n; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, n));
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(6, '0')}  ${hex.padEnd(48)}  ${ascii}`);
  }
  const pre = document.createElement('pre');
  pre.textContent = `${bytes.length} bytes${bytes.length > n ? ` (first ${n} shown)` : ''}\n\n${lines.join('\n')}`;
  if (append) viewEl.append(pre);
  else viewEl.replaceChildren(head, pre);
}

filterEl.oninput = renderList;
paletteEl.onchange = render;
scaleEl.onchange = render;
folderEl.onchange = async () => {
  if (!folderEl.files) return;
  try {
    setArchive(await loadFromFolder(folderEl.files));
  } catch (err) {
    statusEl.textContent = (err as Error).message;
  }
};

statusEl.textContent = 'Loading…';
loadFromDevServer()
  .then((a) => {
    if (a) setArchive(a);
    else {
      loaderEl.hidden = false;
      statusEl.textContent = 'Choose your Betrayal at Krondor install folder';
    }
  })
  .catch((err) => {
    loaderEl.hidden = false;
    statusEl.textContent = `Could not load game data: ${(err as Error).message}`;
  });
