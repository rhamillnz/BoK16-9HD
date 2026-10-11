import { resolveItemIcon } from '../data/itemIcons';
import { effectiveSkill } from '../formats/gam';
import {
  INV_FILTERS,
  INV_SORTS,
  actionsFor,
  buildRows,
  compareWithEquipped,
  defaultAction,
  describeRow,
  formatMoney,
  keepSelection,
  moveSelection,
  statusNotes,
  visibleRows,
  type InvAction,
  type InvFilter,
  type InvRow,
  type InvSort,
} from './inventoryModel';
import type { HudEvent, HudHost } from './hudRegistry';

/**
 * The "list + details" inventory as a DOM overlay: party on the left, a filterable sortable item
 * list in the middle, details and actions on the right. Opened and closed by the HUD registry
 * (`InventoryScreen` in builtinScreens.ts); it only reads the host and calls `host.itemHandler`.
 */

const STAGE_W = 1920;
const STAGE_H = 1080;

const CSS = `
.inv-root{position:fixed;inset:0;z-index:40;background:rgba(6,3,1,.62);font-family:Georgia,'Times New Roman',serif;color:#2b1a0c;user-select:none}
.inv-stage{position:absolute;left:50%;top:50%;width:${STAGE_W}px;height:${STAGE_H}px;transform-origin:center;display:grid;grid-template-columns:340px minmax(0,1fr) 560px;grid-template-rows:auto 1fr auto;gap:20px;padding:40px 48px;box-sizing:border-box;
 background:linear-gradient(180deg,#1f140a,#0d0703);border:4px solid #b08850;box-shadow:0 0 0 2px #2a1a0e,0 20px 80px #000}
.inv-title{grid-column:1/4;display:flex;align-items:baseline;gap:32px;font-family:Cinzel,Georgia,serif;font-weight:700;color:#e8c060;border-bottom:2px solid #6a4a20;padding-bottom:10px}
.inv-title h1{margin:0;font-size:42px;letter-spacing:3px;font-weight:700}
.inv-title .gold{margin-left:auto;font-size:26px;color:#f0d890}
.inv-title .hint{font-size:20px;color:#a08860;font-family:Georgia,serif;font-weight:400}
.inv-party{display:flex;flex-direction:column;gap:14px;overflow:hidden}
.inv-member{display:flex;gap:14px;align-items:center;padding:12px;background:#2a1a0e;border:2px solid #4a2c12;cursor:pointer;color:#f0e0b8}
.inv-member:hover{border-color:#b08850}
.inv-member.on{background:#5a3c18;border-color:#e8c060}
.inv-member canvas{width:72px;height:72px;image-rendering:pixelated;background:#120a04;border:2px solid #6a4a20;flex:none}
.inv-member .nm{font-family:Cinzel,Georgia,serif;font-weight:700;font-size:26px;line-height:1.1}
.inv-member .num{font-size:18px;color:#a08860;margin-left:6px}
.inv-bar{height:10px;background:#120a04;border:1px solid #6a4a20;margin-top:8px}
.inv-bar>i{display:block;height:100%;background:#7ec050}
.inv-bar.low>i{background:#d05040}
.inv-sub{font-size:18px;color:#c8b088;margin-top:4px}
.inv-mid{min-width:0;display:flex;flex-direction:column;min-height:0;gap:14px}
.inv-tabs{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.inv-tab,.inv-sort{white-space:nowrap;padding:8px 16px;font-size:22px;background:#2a1a0e;border:2px solid #4a2c12;color:#f0e0b8;cursor:pointer;font-family:Cinzel,Georgia,serif;font-weight:700}
.inv-tab .cnt{font-family:Georgia,serif;font-weight:400;font-size:18px;color:#c8b088}
.inv-tab.on{background:#6a4a20;border-color:#e8c060;color:#fff0c8}
.inv-sort{font-size:18px;padding:6px 12px;font-family:Georgia,serif;font-weight:400}
.inv-sort.on{border-color:#e8c060;color:#e8c060}
.inv-sortlabel{margin-left:12px;color:#a08860;font-size:18px}
.inv-list{flex:1;min-height:0;overflow-y:auto;background:#150d06;border:2px solid #4a2c12;scrollbar-color:#b08850 #2a1a0e}
.inv-row{display:grid;grid-template-columns:64px 1fr 110px 90px 40px;align-items:center;gap:14px;padding:6px 14px;font-size:26px;color:#f0e0b8;border-bottom:1px solid #2a1a0e;cursor:pointer}
.inv-row:hover{background:#2a1a0e}
.inv-row.sel{background:#5a3c18;outline:2px solid #e8c060;outline-offset:-2px}
.inv-row img{width:56px;height:56px;object-fit:contain;image-rendering:pixelated}
.inv-row .noimg{width:56px;height:56px;background:#2a1a0e;border:1px dashed #6a4a20}
.inv-row .am{text-align:right;color:#c8b088;font-size:22px}
.inv-row .val{text-align:right;color:#e8c060;font-size:22px}
.inv-row .eq{color:#80d080;font-weight:700;text-align:center}
.inv-row.ring .nm{color:#f0d890}
.inv-row.broken .nm{color:#d07060}
.inv-empty{padding:40px;font-size:24px;color:#a08860;text-align:center}
.inv-detail{display:flex;flex-direction:column;gap:12px;min-height:0;padding:22px 26px;background:#e9d8ab;border:4px solid #8a6a30;box-shadow:inset 0 0 40px #b8985a}
.inv-detail h2{margin:0;font-family:Cinzel,Georgia,serif;font-size:34px;color:#3a200c;border-bottom:2px solid #8a6a30;padding-bottom:8px}
.inv-detail .head{display:flex;gap:18px;align-items:center}
.inv-detail .head img{width:96px;height:96px;object-fit:contain;image-rendering:pixelated;background:#d8c490;border:2px solid #8a6a30;flex:none}
.inv-detail .type{font-size:22px;color:#6a4a20;font-style:italic}
.inv-detail p{margin:0;font-size:23px;line-height:1.3}
.inv-detail .note{color:#6a2a10}
.inv-stats{display:grid;grid-template-columns:1fr auto auto;gap:4px 18px;font-size:22px}
.inv-stats .l{color:#4a2c12}
.inv-stats .o{color:#6a5a40}
.inv-stats .up{color:#2a6a1a;font-weight:700}
.inv-stats .dn{color:#a02a1a;font-weight:700}
.inv-vs{font-size:20px;color:#6a4a20}
.inv-actions{margin-top:auto;display:flex;flex-wrap:wrap;gap:10px}
.inv-btn{padding:10px 16px;font-size:23px;font-family:Cinzel,Georgia,serif;font-weight:700;background:#5a3c18;color:#fff0c8;border:2px solid #3a200c;cursor:pointer;box-shadow:0 2px 0 #2a1608}
.inv-btn:hover{background:#7a5226}
.inv-btn.off{background:#b8a478;color:#7a6a48;border-color:#8a7a58;box-shadow:none;cursor:not-allowed}
.inv-btn.pick{outline:3px solid #e8c060}
.inv-btn kbd{font:inherit;font-size:16px;opacity:.75;margin-left:8px}
.inv-status{grid-column:1/4;font-size:24px;color:#f0d890;min-height:34px;border-top:2px solid #6a4a20;padding-top:10px;display:flex;gap:28px}
.inv-status .keys{margin-left:auto;font-size:18px;color:#a08860}
.inv-menu{position:fixed;z-index:60;min-width:260px;background:#e9d8ab;border:3px solid #3a200c;box-shadow:0 8px 30px #000;padding:4px;font-family:Georgia,serif}
.inv-menu div{padding:8px 14px;font-size:22px;color:#2b1a0c;cursor:pointer;white-space:nowrap}
.inv-menu div:hover{background:#c8a860}
.inv-menu div.off{color:#8a7a58;cursor:not-allowed}
.inv-menu div.off:hover{background:none}
`;

const KEYS_HINT = '↑↓ choose   Enter use   X equip   G give   R repair   1-6 / Tab character   Esc close';

/** Which keyboard shortcuts ask for which action. */
export function actionForKey(key: string): 'use' | 'equip' | 'give' | 'repair' | undefined {
  switch (key.length === 1 ? key.toLowerCase() : key) {
    case 'Enter':
    case 'u':
      return 'use';
    case 'x':
      return 'equip';
    case 'g':
      return 'give';
    case 'r':
      return 'repair';
    default:
      return undefined;
  }
}

export class InventoryView {
  private root: HTMLElement | undefined;
  private stage: HTMLElement | undefined;
  private menu: HTMLElement | undefined;
  private character = 0;
  private filter: InvFilter = 'all';
  private sort: InvSort = 'name';
  private selected: string | undefined;
  private status = '';
  private giveMode = false;
  private lastClick: { id: string; at: number } | undefined;
  private shown: { party: unknown; ring: unknown } | undefined;
  private readonly iconUrls = new Map<number, string>();
  private readonly onResize = () => this.fit();

  constructor(private readonly host: HudHost) {}

  get isOpen(): boolean {
    return this.root !== undefined;
  }

  open(): void {
    this.close();
    // The HUD logic is tested without a DOM: there the view stays empty.
    if (typeof document === 'undefined') return;
    this.character = Math.min(this.character, Math.max(0, this.host.party.length - 1));
    this.giveMode = false;
    this.status = '';
    this.menu = undefined;
    ensureStyle();
    const root = document.createElement('div');
    root.className = 'inv-root';
    const stage = document.createElement('div');
    stage.className = 'inv-stage';
    root.appendChild(stage);
    root.addEventListener('mousedown', (e) => {
      // Keep keyboard focus out of the page; clicking the backdrop closes a context menu only.
      e.preventDefault();
      if (!(e.target as HTMLElement).closest('.inv-menu')) this.closeMenu();
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(root);
    this.root = root;
    this.stage = stage;
    window.addEventListener('resize', this.onResize);
    this.render();
    this.fit();
  }

  close(): void {
    this.closeMenu();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onResize);
    this.root?.remove();
    this.root = undefined;
    this.stage = undefined;
  }

  /** Redraw when the party or key ring objects were replaced since the last render (not on every HUD redraw). */
  refresh(): void {
    if (this.root && (this.shown?.party !== this.host.party || this.shown?.ring !== this.host.keyRing)) this.render();
  }

  private fit(): void {
    if (!this.stage) return;
    const ui = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H) * Math.min(1, ui);
    this.stage.style.transform = `translate(-50%,-50%) scale(${s})`;
  }

  private rows(): InvRow[] {
    const c = this.host.party[this.character];
    return visibleRows(buildRows(c, this.host.keyRing, this.host.items), this.filter, this.sort);
  }

  private allRows(): InvRow[] {
    return buildRows(this.host.party[this.character], this.host.keyRing, this.host.items);
  }

  private selectedRow(rows = this.rows()): InvRow | undefined {
    return rows.find((r) => r.id === this.selected);
  }

  private actions(row: InvRow | undefined): InvAction[] {
    if (!row) return [];
    return actionsFor(row, {
      party: this.host.party,
      owner: this.host.party[this.character],
      defs: this.host.items,
    });
  }

  private run(action: InvAction, row: InvRow): void {
    const owner = this.host.party[this.character];
    const handler = this.host.itemHandler;
    this.closeMenu();
    this.giveMode = false;
    if (!owner || !handler || row.source !== 'pack') return;
    if (action.id === 'give' && action.target === undefined) return;
    const before = this.rows();
    const at = before.findIndex((r) => r.id === row.id);
    this.status = handler.act(action.id, owner.index, row.slot, action.target);
    this.host.invalidate();
    // The host rebuilt `party`; the selection stays on the same place in the list when the item is gone.
    this.selected = keepSelection(this.rows(), this.selected, at);
    this.render();
  }

  private trigger(id: InvAction['id'], target?: number): void {
    const row = this.selectedRow();
    if (!row) return;
    const a = this.actions(row).find((x) => x.id === id && (target === undefined || x.target === target));
    if (!a) {
      this.status = id === 'repair' ? `${row.name} cannot be repaired.` : 'Nothing to do.';
      this.render();
      return;
    }
    if (!a.enabled) {
      this.status = a.reason ?? 'Not available.';
      this.render();
      return;
    }
    this.run(a, row);
  }

  /** Keyboard (from the HUD) and the HUD's pointer events, which the DOM handles itself. */
  event(ev: HudEvent): void {
    if (!this.root || ev.type !== 'key') return;
    if (this.menu) this.closeMenu();
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const party = this.host.party;
    if (this.giveMode && /^[1-6]$/.test(key)) {
      const target = party[Number(key) - 1];
      const owner = party[this.character];
      if (target && target !== owner) this.trigger('give', target.index);
      else {
        this.status = target ? 'They already carry it.' : 'No such party member.';
        this.giveMode = false;
        this.render();
      }
      return;
    }
    if (this.giveMode && key !== 'g') {
      this.giveMode = false;
      this.status = '';
    }
    if (/^[1-6]$/.test(key)) {
      if (party[Number(key) - 1]) this.pickCharacter(Number(key) - 1);
      return;
    }
    const rows = this.rows();
    switch (key) {
      case 'ArrowUp':
      case 'w':
        this.selected = moveSelection(rows, this.selected, -1);
        this.render();
        return;
      case 'ArrowDown':
      case 's':
        this.selected = moveSelection(rows, this.selected, 1);
        this.render();
        return;
      case 'PageUp':
        this.selected = moveSelection(rows, this.selected, -8);
        this.render();
        return;
      case 'PageDown':
        this.selected = moveSelection(rows, this.selected, 8);
        this.render();
        return;
      case 'Home':
        this.selected = rows[0]?.id;
        this.render();
        return;
      case 'End':
        this.selected = rows[rows.length - 1]?.id;
        this.render();
        return;
      case 'ArrowLeft':
      case 'a':
      case 'q':
        this.pickCharacter((this.character + party.length - 1) % party.length);
        return;
      case 'ArrowRight':
      case 'd':
      case 'e':
      case 'Tab':
        this.pickCharacter((this.character + 1) % party.length);
        return;
      case 'f':
        this.cycle(
          INV_FILTERS.map((f) => f.id),
          'filter',
        );
        return;
      case 'o':
        this.cycle(
          INV_SORTS.map((s) => s.id),
          'sort',
        );
        return;
    }
    const action = actionForKey(ev.key);
    if (action === 'give') {
      const row = this.selectedRow(rows);
      if (!row) return;
      const others = this.actions(row).filter((a) => a.id === 'give');
      if (others.length === 0) this.status = 'There is nobody to give it to.';
      else if (row.source === 'ring') this.status = this.actions(row)[0]?.reason ?? '';
      else {
        this.giveMode = !this.giveMode;
        this.status = this.giveMode
          ? `Give ${row.name} to: ${party
              .map((c, i) => (c === party[this.character] ? '' : `${i + 1} ${c.name}`))
              .filter(Boolean)
              .join('   ')}`
          : '';
      }
      this.render();
    } else if (action) this.trigger(action);
  }

  private cycle(list: string[], what: 'filter' | 'sort'): void {
    const cur = what === 'filter' ? this.filter : this.sort;
    const next = list[(list.indexOf(cur) + 1) % list.length]!;
    if (what === 'filter') this.setFilter(next as InvFilter);
    else this.setSort(next as InvSort);
  }

  private pickCharacter(i: number): void {
    this.character = i;
    this.giveMode = false;
    this.status = '';
    this.selected = keepSelection(this.rows(), undefined);
    this.render();
  }

  private setFilter(f: InvFilter): void {
    this.filter = f;
    this.selected = keepSelection(this.rows(), this.selected);
    this.render();
  }

  private setSort(s: InvSort): void {
    this.sort = s;
    this.render();
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = undefined;
  }

  private showMenu(x: number, y: number, row: InvRow): void {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'inv-menu';
    for (const a of this.actions(row)) {
      const item = document.createElement('div');
      item.textContent = a.label;
      if (!a.enabled) {
        item.className = 'off';
        item.title = a.reason ?? '';
      } else {
        item.addEventListener('click', () => this.run(a, row));
      }
      menu.appendChild(item);
    }
    menu.style.left = `${Math.min(x, window.innerWidth - 300)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 40 * (menu.childElementCount + 1))}px`;
    this.root?.appendChild(menu);
    this.menu = menu;
  }

  private iconUrl(imageIndex: number): string | undefined {
    const cached = this.iconUrls.get(imageIndex);
    if (cached !== undefined) return cached || undefined;
    const set = this.host.icons;
    const icon = set && resolveItemIcon(set, imageIndex);
    let url = '';
    if (icon) {
      const c = document.createElement('canvas');
      c.width = icon.width;
      c.height = icon.height;
      c.getContext('2d')!.putImageData(new ImageData(icon.rgba, icon.width, icon.height), 0, 0);
      url = c.toDataURL();
    }
    this.iconUrls.set(imageIndex, url);
    return url || undefined;
  }

  private render(): void {
    const stage = this.stage;
    if (!stage) return;
    const host = this.host;
    this.shown = { party: host.party, ring: host.keyRing };
    const rows = this.rows();
    this.selected = keepSelection(rows, this.selected);
    const row = this.selectedRow(rows);
    const owner = host.party[this.character];
    stage.textContent = '';
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      parent?.appendChild(e);
      return e;
    };

    // Title
    const title = el('div', 'inv-title', undefined, stage);
    el('h1', undefined, owner ? `${owner.name}'s pack` : 'Inventory', title);
    el(
      'span',
      'hint',
      owner ? `${owner.inventory.items.length} of ${owner.inventory.capacity} places used` : '',
      title,
    );
    el('span', 'gold', `Party purse: ${formatMoney(host.gold)}`, title);

    // Party column
    const party = el('div', 'inv-party', undefined, stage);
    host.party.forEach((c, i) => {
      const m = el('div', `inv-member${i === this.character ? ' on' : ''}`, undefined, party);
      const face = el('canvas', undefined, undefined, m);
      face.width = 32;
      face.height = 32;
      const portrait = host.portrait?.(c.index);
      if (portrait) face.getContext('2d')!.drawImage(portrait, 0, 0, 32, 32);
      const info = el('div', undefined, undefined, m);
      const nm = el('div', 'nm', c.name, info);
      el('span', 'num', String(i + 1), nm);
      const hp = effectiveSkill(c, 'health');
      const max = effectiveSkill(c, 'health', 'max');
      const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
      const bar = el('div', `inv-bar${frac < 0.34 ? ' low' : ''}`, undefined, info);
      el('i', undefined, undefined, bar).style.width = `${Math.round(frac * 100)}%`;
      el('div', 'inv-sub', `Health ${hp} / ${max}`, info);
      el('div', 'inv-sub', `${c.inventory.items.length} / ${c.inventory.capacity} items`, info);
      m.addEventListener('click', () => this.pickCharacter(i));
    });

    // Middle: filters, sort, list
    const mid = el('div', 'inv-mid', undefined, stage);
    const tabs = el('div', 'inv-tabs', undefined, mid);
    const all = this.allRows();
    for (const f of INV_FILTERS) {
      const count = all.filter((r) => visibleRows([r], f.id, 'name').length > 0).length;
      const t = el('div', `inv-tab${f.id === this.filter ? ' on' : ''}`, f.label, tabs);
      el('span', 'cnt', ` ${count}`, t);
      t.addEventListener('click', () => this.setFilter(f.id));
    }
    el('span', 'inv-sortlabel', 'Sort', tabs);
    for (const s of INV_SORTS) {
      const t = el('div', `inv-sort${s.id === this.sort ? ' on' : ''}`, s.label, tabs);
      t.addEventListener('click', () => this.setSort(s.id));
    }
    const list = el('div', 'inv-list', undefined, mid);
    if (rows.length === 0) {
      el('div', 'inv-empty', this.filter === 'all' ? 'Nothing carried.' : 'Nothing of this kind.', list);
    }
    for (const r of rows) {
      const d = el(
        'div',
        `inv-row${r.id === this.selected ? ' sel' : ''}${r.source === 'ring' ? ' ring' : ''}${r.broken ? ' broken' : ''}`,
        undefined,
        list,
      );
      d.dataset.id = r.id;
      const url = this.iconUrl(r.imageIndex);
      if (url) {
        const img = el('img', undefined, undefined, d);
        img.src = url;
        img.alt = '';
      } else el('div', 'noimg', undefined, d);
      el('div', 'nm', r.source === 'ring' ? `${r.name}  (key ring)` : r.name, d);
      el('div', 'am', r.amount || r.typeLabel, d);
      el('div', 'val', r.value ? `${r.value}` : '', d);
      el('div', 'eq', r.equipped ? 'E' : '', d);
      // Double-click is timed by hand: the list is rebuilt on every click, so the browser's own dblclick is unreliable.
      d.addEventListener('click', () => {
        const now = performance.now();
        const again = this.lastClick?.id === r.id && now - this.lastClick.at < 450;
        this.lastClick = again ? undefined : { id: r.id, at: now };
        this.selected = r.id;
        this.giveMode = false;
        this.closeMenu();
        const a = again ? defaultAction(this.actions(r)) : undefined;
        if (a) this.run(a, r);
        else this.render();
      });
      d.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.selected = r.id;
        this.render();
        this.showMenu(e.clientX, e.clientY, r);
      });
    }
    const selEl = list.querySelector('.inv-row.sel') as HTMLElement | null;
    selEl?.scrollIntoView({ block: 'nearest' });

    // Details
    const detail = el('div', 'inv-detail', undefined, stage);
    if (!row) {
      el('h2', undefined, 'No item selected', detail);
      el('p', undefined, 'Pick an item from the list to see what it does.', detail);
    } else {
      el('h2', undefined, row.name, detail);
      const head = el('div', 'head', undefined, detail);
      const url = this.iconUrl(row.imageIndex);
      if (url) {
        const img = el('img', undefined, undefined, head);
        img.src = url;
        img.alt = '';
      }
      const meta = el('div', undefined, undefined, head);
      el('div', 'type', row.typeLabel, meta);
      for (const n of statusNotes(row)) el('div', undefined, n, meta);
      if (row.value) el('div', undefined, `Value ${row.value}`, meta);
      for (const line of describeRow(row))
        el('p', row.source === 'ring' || row.typeLabel === 'Lockpick' ? 'note' : undefined, line, detail);
      const cmp = compareWithEquipped(row, this.allRows(), host.items);
      if (cmp.stats.length) {
        if (cmp.against) el('div', 'inv-vs', `Compared with equipped ${cmp.against.name}`, detail);
        const grid = el('div', 'inv-stats', undefined, detail);
        for (const s of cmp.stats) {
          el('span', 'l', s.label, grid);
          el('span', undefined, String(s.value), grid);
          if (s.delta === undefined) el('span', 'o', '', grid);
          else {
            const sign = s.delta > 0 ? '+' : '';
            el('span', s.delta > 0 ? 'up' : s.delta < 0 ? 'dn' : 'o', `${sign}${s.delta}`, grid);
          }
        }
      }
      const actions = el('div', 'inv-actions', undefined, detail);
      for (const a of this.actions(row)) {
        const slot = a.target !== undefined ? host.party.findIndex((c) => c.index === a.target) + 1 : 0;
        const b = el(
          'div',
          `inv-btn${a.enabled ? '' : ' off'}${this.giveMode && a.id === 'give' && a.enabled ? ' pick' : ''}`,
          a.label,
          actions,
        );
        if (slot > 0) el('kbd', undefined, String(slot), b);
        if (a.reason) b.title = a.reason;
        b.addEventListener('click', () => {
          if (a.enabled) this.run(a, row);
          else {
            this.status = a.reason ?? 'Not available.';
            this.render();
          }
        });
      }
    }

    // Status
    const status = el('div', 'inv-status', undefined, stage);
    el('span', undefined, this.status, status);
    el('span', 'keys', KEYS_HINT, status);
  }
}

let styled = false;
function ensureStyle(): void {
  if (styled || typeof document === 'undefined') return;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
  styled = true;
}
