import { CONDITION_NAMES, effectiveSkill, type Character } from '../formats/gam';
import { HotspotAction, templeNumber } from '../formats/gds';
import { findGdsContainer, type GdsContainer, type ShopStats } from '../formats/gdsShops';
import type { ItemDef } from '../formats/objinfo';
import type { ReqLayout } from '../formats/req';
import type { MenuModel } from '../ui/menuScreen';
import type { PartyState } from './party';
import type { WorldState } from './state';
import type { ActionContext, DialogEnd, TownController } from './townController';
import {
  TEMPLE_CHOICE,
  TEMPLE_DIALOG,
  TEMPLE_OF_SUNG,
  applyBlessing,
  applyCure,
  blessPrice,
  canBless,
  canTeleportAnywhere,
  cureQuotes,
  isBlessed,
  markTempleSeen,
  seenTemples,
  teleportBlocked,
  teleportCost,
} from './temple';

/** The slice of the HUD the temple screens use. */
export interface MenuHost {
  show(model: MenuModel, onPick: (id: string) => void, onCancel: () => void): void;
  close(): void;
}

export interface TempleDeps {
  menu: MenuHost;
  playDialog(key: number, done: (end: DialogEnd) => void): void;
  getParty(): PartyState;
  setParty(p: PartyState): void;
  getWorld(): WorldState;
  setWorld(w: WorldState): void;
  items: readonly ItemDef[];
  /** The town containers of the save (shop statistics live there). */
  containers(): readonly GdsContainer[];
  /** REQ_TELE.DAT: the temples' spots on the teleport map and their names. Without it teleporting is unavailable. */
  teleportLayout: ReqLayout | undefined;
  /** Move the party to entry `index` of TELEPORT.DAT. */
  travel(index: number): void;
}

/** "3 sovereigns 4 royals" for an amount in royals (ten royals to the sovereign). */
export function formatRoyals(royals: number): string {
  const s = Math.trunc(royals / 10);
  const r = royals % 10;
  const parts: string[] = [];
  if (s > 0) parts.push(`${s} sovereign${s === 1 ? '' : 's'}`);
  if (r > 0 || s === 0) parts.push(`${r} royal${r === 1 ? '' : 's'}`);
  return parts.join(' ');
}

const CONDITION_LABELS: Record<(typeof CONDITION_NAMES)[number], string> = {
  sick: 'Sick', plagued: 'Plagued', poisoned: 'Poisoned', drunk: 'Drunk', healing: 'Healing', starving: 'Starving', nearDeath: 'Near death',
};

/** "Sick 20, Poisoned 5" for a character's ailments (Healing is a blessing, not an ailment). */
export function ailments(c: Character): string {
  const list = CONDITION_NAMES.filter((n) => n !== 'healing' && c.conditions[n] > 0).map((n) => `${CONDITION_LABELS[n]} ${c.conditions[n]}`);
  return list.length ? list.join(', ') : 'No ailments';
}

const stripMarkup = (label: string) => label.replace(/^#/, '');

/**
 * Install the temple features on a town controller: the Temple hotspot (talk, cure, bless) and the Teleport
 * hotspot, plus marking temples as seen when their scene opens.
 */
export function installTemples(town: TownController, d: TempleDeps): void {
  const shopOf = (ctx: ActionContext): ShopStats | undefined => findGdsContainer(d.containers(), ctx.scene.ref)?.shop;

  town.onEnter((scene, active) => {
    const temple = templeNumber(scene.gds);
    if (temple === undefined || !active.some((h) => h.action === HotspotAction.Teleport)) return;
    d.setWorld(markTempleSeen(d.getWorld(), temple));
  });

  town.handle(HotspotAction.Temple, (ctx) => {
    const temple = templeNumber(ctx.scene.gds);
    if (temple === undefined) return ctx.done();
    runTemple(ctx, temple, shopOf(ctx));
  });

  town.handle(HotspotAction.Teleport, (ctx) => {
    const temple = templeNumber(ctx.scene.gds);
    if (temple === undefined) return ctx.done();
    runTeleport(ctx, temple, shopOf(ctx));
  });

  // ---- Temple: the dialogue offers Talk, Cure, Bless and Done ------------------------------------------

  function runTemple(ctx: ActionContext, temple: number, shop: ShopStats | undefined): void {
    const again = () => runTemple(ctx, temple, shop);
    d.playDialog(ctx.hotspot.arg3, (end) => {
      if (end.cancelled) return ctx.done();
      // A SetEndOfDialogState of -1 means the dialogue refused (not sick, scene closed to this service).
      const refused = end.endState === -1;
      switch (end.choice) {
        case TEMPLE_CHOICE.talk:
          return again();
        case TEMPLE_CHOICE.cure:
          return refused || !shop ? again() : startCure(temple, shop, again);
        case TEMPLE_CHOICE.bless:
          return refused || !shop ? again() : startBless(shop, again);
        default:
          return ctx.done();
      }
    });
  }

  function startCure(temple: number, shop: ShopStats, back: () => void): void {
    const first = cureQuotes(d.getParty(), shop.haggleDifficulty, temple).find((q) => q.cost > 0);
    if (!first) {
      const key = temple === TEMPLE_OF_SUNG ? TEMPLE_DIALOG.healCantHealNotSick : TEMPLE_DIALOG.healCantHealNotSickEnough;
      return d.playDialog(key, back);
    }
    cureMenu(temple, shop, first.character.index, '', back);
  }

  function cureMenu(temple: number, shop: ShopStats, who: number, message: string, back: () => void): void {
    const party = d.getParty();
    const quotes = cureQuotes(party, shop.haggleDifficulty, temple);
    const q = quotes.find((x) => x.character.index === who);
    if (!q || q.cost === 0) {
      const next = quotes.find((x) => x.cost > 0);
      if (!next) return back();
      return cureMenu(temple, shop, next.character.index, message, back);
    }
    const c = q.character;
    const needy = quotes.filter((x) => x.cost > 0);
    const lines = [c.name, ailments(c)];
    if (temple === TEMPLE_OF_SUNG) {
      lines.push(`Health and stamina ${effectiveSkill(c, 'health') + effectiveSkill(c, 'stamina')} of ${effectiveSkill(c, 'health', 'max') + effectiveSkill(c, 'stamina', 'max')}`);
    }
    lines.push(`Cost: ${formatRoyals(q.cost)}   You have: ${formatRoyals(party.gold)}`);
    d.menu.show(
      {
        title: 'Temple healing',
        lines,
        rows: [],
        message,
        buttons: [
          { id: 'cure', label: 'Cure' },
          { id: 'next', label: 'Next player', enabled: needy.length > 1 },
          { id: 'done', label: 'Done' },
        ],
      },
      (id) => {
        if (id === 'cure') {
          const r = applyCure(party, who, shop.haggleDifficulty, temple);
          if (!r.ok) return cureMenu(temple, shop, who, 'You cannot afford that.', back);
          d.setParty(r.party);
          d.menu.close();
          return d.playDialog(TEMPLE_DIALOG.healPostHealing, () => {
            const rest = cureQuotes(d.getParty(), shop.haggleDifficulty, temple).find((x) => x.cost > 0);
            if (rest) cureMenu(temple, shop, rest.character.index, '', back);
            else back();
          });
        }
        if (id === 'next') {
          const at = needy.findIndex((x) => x.character.index === who);
          return cureMenu(temple, shop, needy[(at + 1) % needy.length]!.character.index, '', back);
        }
        d.menu.close();
        back();
      },
      () => {
        d.menu.close();
        back();
      },
    );
  }

  function startBless(shop: ShopStats, back: () => void): void {
    blessMenu(shop, '', back);
  }

  function blessMenu(shop: ShopStats, message: string, back: () => void): void {
    const party = d.getParty();
    const rows: MenuModel['rows'] = [];
    for (const i of party.activeCharacters) {
      const c = party.characters.find((x) => x.index === i);
      c?.inventory.items.forEach((item, slot) => {
        const def = d.items[item.itemIndex];
        if (!def || !canBless(def)) return;
        const price = blessPrice(def, shop);
        rows.push({ id: `${c.index}:${slot}`, label: `${c.name}: ${def.name}${isBlessed(item) ? ' (blessed)' : ''}`, detail: formatRoyals(price), enabled: price <= party.gold });
      });
    }
    d.menu.show(
      {
        title: 'Blessings',
        lines: [rows.length ? 'Choose a weapon or armour to bless. A new blessing replaces an old one.' : 'Nothing you carry can be blessed.', `You have: ${formatRoyals(party.gold)}`],
        rows,
        message,
        buttons: [{ id: 'done', label: 'Done' }],
      },
      (id) => {
        if (id === 'done') {
          d.menu.close();
          return back();
        }
        const [who, slot] = id.split(':').map(Number) as [number, number];
        const r = applyBlessing(d.getParty(), who, slot, d.items, shop);
        if (!r.ok) return blessMenu(shop, r.reason === 'cannotAfford' ? 'You cannot afford that.' : 'That cannot be blessed.', back);
        d.setParty(r.party);
        blessMenu(shop, `Blessed for ${formatRoyals(r.cost)}.`, back);
      },
      () => {
        d.menu.close();
        back();
      },
    );
  }

  // ---- Teleport: choose another temple you have seen -----------------------------------------------------

  function runTeleport(ctx: ActionContext, temple: number, shop: ShopStats | undefined): void {
    if (teleportBlocked(d.getWorld(), temple)) return d.playDialog(TEMPLE_DIALOG.teleportBlockedSource, () => ctx.done());
    d.playDialog(TEMPLE_DIALOG.teleportIntro, (end) => {
      if (end.cancelled) return ctx.done();
      if (!shop || !d.teleportLayout || !canTeleportAnywhere(d.getWorld())) {
        return d.playDialog(TEMPLE_DIALOG.teleportNoDestinations, () => ctx.done());
      }
      teleportMenu(ctx, temple, shop, d.teleportLayout, '');
    });
  }

  function teleportMenu(ctx: ActionContext, source: number, shop: ShopStats, layout: ReqLayout, message: string): void {
    const world = d.getWorld();
    const party = d.getParty();
    const spot = (t: number) => layout.widgets[t - 1];
    const label = (t: number) => stripMarkup(spot(t)?.label || `Temple ${t}`);
    const rows: MenuModel['rows'] = [];
    for (const t of seenTemples(world)) {
      const here = spot(source);
      const there = spot(t);
      if (t === source || !here || !there) continue;
      const cost = teleportCost(here, there, shop.haggleAnnoyance, shop.categories);
      const closed = teleportBlocked(world, t);
      rows.push({ id: String(t), label: label(t), detail: closed ? 'closed' : formatRoyals(cost), enabled: !closed && cost <= party.gold });
    }
    const leave = () => {
      d.menu.close();
      d.playDialog(TEMPLE_DIALOG.teleportCancel, () => ctx.done());
    };
    d.menu.show(
      {
        title: 'Teleport',
        lines: [`From: ${label(source)}`, `You have: ${formatRoyals(party.gold)}`],
        rows,
        message,
        buttons: [{ id: 'cancel', label: 'Cancel' }],
      },
      (id) => {
        if (id === 'cancel') return leave();
        const t = Number(id);
        const here = spot(source)!;
        const cost = teleportCost(here, spot(t)!, shop.haggleAnnoyance, shop.categories);
        if (cost > party.gold) return teleportMenu(ctx, source, shop, layout, 'You cannot afford that.');
        d.setParty({ ...party, gold: party.gold - cost });
        d.menu.close();
        d.playDialog(TEMPLE_DIALOG.teleportPost, () => {
          town.dismiss();
          ctx.done();
          d.travel(t - 1);
        });
      },
      leave,
    );
  }
}
