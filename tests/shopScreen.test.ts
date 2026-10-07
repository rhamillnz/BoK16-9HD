import { describe, expect, it } from 'vitest';
import type { Font, Glyph } from '../src/formats/fnt';
import type { GamSave } from '../src/formats/gam';
import { HudScreens } from '../src/ui/hud';
import '../src/ui/shopHudScreen'; // registers the screen
import type { ShopHudScreen, ShopView } from '../src/ui/shopHudScreen';
import {
  SHOP_ROWS_PER_PAGE, initialShopState, layoutShopScreen, shopPageCount, stepShopScreen, type ShopModel,
} from '../src/ui/shopScreen';

const row = (label: string) => ({ label, price: '1 roy', dim: false });
const model = (stock = 3, pack = 2): ShopModel => ({
  title: 'Shop', purse: 'Purse', members: ['A', 'B', 'C'],
  stock: Array.from({ length: stock }, (_, i) => row(`s${i}`)), pack: Array.from({ length: pack }, (_, i) => row(`p${i}`)),
});
const layout = layoutShopScreen(3);
const centre = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

describe('stepShopScreen', () => {
  it('clicks a stock row to buy and a pack row to sell', () => {
    const s = initialShopState();
    const buy = stepShopScreen(layout, s, model(), { type: 'click', ...centre(layout.stockRows[1]!.rect) });
    expect(buy.result).toEqual({ kind: 'buy', stock: 1 });
    const sell = stepShopScreen(layout, s, model(), { type: 'click', ...centre(layout.packRows[0]!.rect) });
    expect(sell.result).toEqual({ kind: 'sell', pack: 0 });
  });

  it('ignores clicks on empty rows', () => {
    const r = stepShopScreen(layout, initialShopState(), model(), { type: 'click', ...centre(layout.stockRows[5]!.rect) });
    expect(r.result).toEqual({ kind: 'none' });
  });

  it('haggles with right click or H over a stock row, not over the pack', () => {
    const right = stepShopScreen(layout, initialShopState(), model(), { type: 'rightClick', ...centre(layout.stockRows[2]!.rect) });
    expect(right.result).toEqual({ kind: 'haggle', stock: 2 });
    const hovered = stepShopScreen(layout, initialShopState(), model(), { type: 'hover', ...centre(layout.stockRows[0]!.rect) });
    expect(stepShopScreen(layout, hovered.state, model(), { type: 'key', key: 'h' }).result).toEqual({ kind: 'haggle', stock: 0 });
    const pack = stepShopScreen(layout, initialShopState(), model(), { type: 'rightClick', ...centre(layout.packRows[0]!.rect) });
    expect(pack.result).toEqual({ kind: 'none' });
  });

  it('Enter acts on the hovered row', () => {
    const over = stepShopScreen(layout, initialShopState(), model(), { type: 'hover', ...centre(layout.packRows[1]!.rect) });
    expect(stepShopScreen(layout, over.state, model(), { type: 'key', key: 'Enter' }).result).toEqual({ kind: 'sell', pack: 1 });
  });

  it('switches party member by tab or arrows, wrapping', () => {
    const tab = stepShopScreen(layout, initialShopState(), model(), { type: 'click', ...centre(layout.members[2]!.rect) });
    expect(tab.state.member).toBe(2);
    expect(stepShopScreen(layout, tab.state, model(), { type: 'key', key: 'ArrowRight' }).state.member).toBe(0);
    expect(stepShopScreen(layout, initialShopState(), model(), { type: 'key', key: 'ArrowLeft' }).state.member).toBe(2);
  });

  it('pages the stock and addresses rows by absolute index', () => {
    const big = model(SHOP_ROWS_PER_PAGE + 3);
    expect(shopPageCount(big.stock.length)).toBe(2);
    const next = stepShopScreen(layout, initialShopState(), big, { type: 'click', ...centre(layout.next) });
    expect(next.state.page).toBe(1);
    const buy = stepShopScreen(layout, next.state, big, { type: 'click', ...centre(layout.stockRows[0]!.rect) });
    expect(buy.result).toEqual({ kind: 'buy', stock: SHOP_ROWS_PER_PAGE });
    expect(stepShopScreen(layout, next.state, big, { type: 'click', ...centre(layout.stockRows[4]!.rect) }).result).toEqual({ kind: 'none' });
  });

  it('leaves from the Leave button', () => {
    expect(stepShopScreen(layout, initialShopState(), model(), { type: 'click', ...centre(layout.leave) }).result).toEqual({ kind: 'leave' });
  });
});

describe('shop HUD screen', () => {
  const font: Font = {
    version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32,
    glyphs: Array.from({ length: 95 }, (_, i): Glyph => ({ code: 32 + i, width: 4, height: 6, pixels: new Uint8Array(24) })),
  };
  const hud = () => new HudScreens({ font, save: { characters: [], activeCharacters: [] } as unknown as GamSave, items: [] });

  it('is registered, opens with a view and closes through Escape', () => {
    const h = hud();
    const screen = h.screenHandler<ShopHudScreen>('shop');
    const acts: string[] = [];
    let closed = 0;
    const view: ShopView = { model: () => model(), act: (r) => acts.push(r.kind), closed: () => closed++ };
    h.open('shop');
    expect(h.screen).toBe('none'); // no view yet: refuses to open
    screen.setView(view);
    h.open('shop', { fresh: true });
    expect(h.screen).toBe('shop');
    const l = layoutShopScreen(3, h.width, h.height);
    h.click(...(Object.values(centre(l.stockRows[0]!.rect)) as [number, number]));
    expect(acts).toEqual(['buy']);
    h.keyDown('Escape', 'Escape');
    expect(h.screen).toBe('none');
    expect(closed).toBe(1);
  });
});
