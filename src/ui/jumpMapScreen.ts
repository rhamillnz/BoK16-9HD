import { type MapLayout, layoutMap, MAP_COLORS } from './mapScreen';
import { tileRect, worldToMap, type MapViewport } from './mapMath';
import { chooseScale } from './dialogBox';
import { drawText } from './inventory';
import { measureString } from '../formats/fnt';
import { TILE_SIZE } from '../formats/world';
import { type ZoneMap } from '../formats/zoneMap';
import { type Destination } from '../game/transitions';
import { type HudEvent, type HudHost, type HudScreenHandler } from './hudRegistry';

const ZONE_COUNT = 12;

export type ZoneMapLoader = (zone: number) => Promise<{ map: ZoneMap; tiles: [number, number][] }>;
export type OnTravelTo = (d: Destination) => void;

/**
 * Pure logic: layout zone selection buttons.
 * Returns [minX, maxY] corner and button width for each zone 1..12 across the top.
 */
export function layoutZoneButtons(
  width: number,
  height: number,
  buttonHeight: number = 16 * chooseScale(height),
): { x: number; y: number; width: number; height: number }[] {
  const scale = chooseScale(height);
  const topMargin = 6 * scale;
  const sideMargin = 8 * scale;
  const spacing = 3 * scale;
  const availableWidth = width - 2 * sideMargin;
  const buttonWidth = Math.floor((availableWidth - (ZONE_COUNT - 1) * spacing) / ZONE_COUNT);

  return Array.from({ length: ZONE_COUNT }, (_, i) => ({
    x: sideMargin + i * (buttonWidth + spacing),
    y: topMargin,
    width: buttonWidth,
    height: buttonHeight,
  }));
}

/**
 * Pure logic: check if a click is on one of the zone buttons.
 * Returns zone number (1-12) or undefined if not clicked.
 */
export function zoneButtonAtClick(
  buttons: ReturnType<typeof layoutZoneButtons>,
  clickX: number,
  clickY: number,
): number | undefined {
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i]!;
    if (clickX >= btn.x && clickX < btn.x + btn.width && clickY >= btn.y && clickY < btn.y + btn.height) {
      return i + 1;
    }
  }
  return undefined;
}

/**
 * Pure logic: map a screen click to a tile coordinate (tx, ty).
 * Returns undefined if the click is outside the viewport bounds.
 */
export function tileAtClick(viewport: MapViewport, clickX: number, clickY: number): [number, number] | undefined {
  const { bounds, cell, originX, originY } = viewport;
  const rows = bounds.maxY - bounds.minY + 1;

  // Convert screen coordinates to grid coordinates
  const gridX = (clickX - originX) / cell;
  const gridY = (clickY - originY) / cell;

  // Bounds check
  if (gridX < 0 || gridX >= bounds.maxX - bounds.minX + 1 || gridY < 0 || gridY >= rows) {
    return undefined;
  }

  const tx = Math.floor(gridX) + bounds.minX;
  const ty = bounds.maxY - Math.floor(gridY);

  return [tx, ty];
}

/**
 * Pure logic: build a Destination from zone, tile, and optionally current zone (for same-zone destinations).
 * Tiles are placed at their centre: (tileX + 0.5) * TILE_SIZE, facing north (heading 0).
 */
export function destinationFromTile(zone: number, tileX: number, tileY: number): Destination {
  return {
    zone,
    tileX,
    tileY,
    x: (tileX + 0.5) * TILE_SIZE,
    y: (tileY + 0.5) * TILE_SIZE,
    heading: 0,
  };
}

interface JumpMapState {
  selectedZone: number;
  layouts: Map<number, MapLayout>;
  buttons: ReturnType<typeof layoutZoneButtons>;
  loading: Set<number>; // zones currently being loaded
}

export class JumpMapScreen implements HudScreenHandler {
  hotkey = 'F7';
  hotkeyInBase = true;
  private state: JumpMapState | undefined;
  private onTravelTo: OnTravelTo | undefined;
  private loadZoneMap: ZoneMapLoader | undefined;

  constructor(private readonly host: HudHost) {}

  /** Set up the callback for loading zone maps and traveling. */
  setCallbacks(loadZoneMap: ZoneMapLoader, onTravelTo: OnTravelTo): void {
    this.loadZoneMap = loadZoneMap;
    this.onTravelTo = onTravelTo;
  }

  open(): boolean {
    if (!this.host.map || !this.loadZoneMap) return false;

    const buttons = layoutZoneButtons(this.host.width, this.host.height);
    this.state = {
      selectedZone: this.host.map.zone,
      layouts: new Map(),
      buttons,
      loading: new Set(),
    };

    // Start loading the current zone's map
    void this.loadZoneMapIfNeeded(this.host.map.zone);
    return true;
  }

  private async loadZoneMapIfNeeded(zone: number): Promise<void> {
    const s = this.state;
    if (!s || s.layouts.has(zone) || s.loading.has(zone) || !this.loadZoneMap) return;

    s.loading.add(zone);
    try {
      const { map } = await this.loadZoneMap(zone);
      if (this.state !== s) return; // screen was closed
      // Lay the map out in the space below the zone buttons, then move all of it down there.
      const top = this.buttonAreaHeight(s);
      const layout = layoutMap(map, this.host.width, this.host.height - top);
      s.layouts.set(zone, {
        ...layout,
        panel: { ...layout.panel, y: layout.panel.y + top },
        title: { ...layout.title, y: layout.title.y + top },
        viewport: { ...layout.viewport, originY: layout.viewport.originY + top },
      });
      this.host.invalidate();
    } finally {
      s.loading.delete(zone);
    }
  }

  private buttonAreaHeight(s: JumpMapState): number {
    return s.buttons[0]!.y + s.buttons[0]!.height;
  }

  close(): void {
    this.state = undefined;
  }

  escape(): void {
    this.host.close();
  }

  event(ev: HudEvent): void {
    const s = this.state;
    if (!s) return;

    if (ev.type === 'click') {
      // Check if click is on a zone button
      const zone = zoneButtonAtClick(s.buttons, ev.x, ev.y);
      if (zone !== undefined) {
        s.selectedZone = zone;
        void this.loadZoneMapIfNeeded(zone);
        this.host.invalidate();
        return;
      }

      // Check if click is on the map (below the buttons)
      if (ev.y < this.buttonAreaHeight(s)) return; // Click is in the button area but not on a button

      // Map click to tile
      const layout = s.layouts.get(s.selectedZone);
      if (!layout) return;

      const tile = tileAtClick(layout.viewport, ev.x, ev.y);
      if (!tile) return;

      const dest = destinationFromTile(s.selectedZone, tile[0], tile[1]);
      this.onTravelTo?.(dest);
      this.host.close();
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.state;
    if (!s) return;

    const h = this.host;
    const { width, height, font } = h;
    const scale = chooseScale(height);
    const label = (text: string, x: number, y: number, align: 'left' | 'centre' | 'right' = 'left') => {
      const w = measureString(font, text) * scale;
      const lx = align === 'centre' ? x - w / 2 : align === 'right' ? x - w : x;
      drawText(ctx, font, text, Math.round(lx), Math.round(y), scale, MAP_COLORS.text);
    };

    ctx.fillStyle = MAP_COLORS.backdrop;
    ctx.fillRect(0, 0, width, height);

    // Zone buttons
    s.buttons.forEach((btn, i) => {
      ctx.fillStyle = s.selectedZone === i + 1 ? MAP_COLORS.tileEdge : MAP_COLORS.tile;
      ctx.fillRect(btn.x, btn.y, btn.width, btn.height);
      ctx.strokeStyle = MAP_COLORS.border;
      ctx.lineWidth = scale;
      ctx.strokeRect(btn.x, btn.y, btn.width, btn.height);
      label(`Zone ${i + 1}`, btn.x + btn.width / 2, btn.y + (btn.height - font.height * scale) / 2, 'centre');
    });

    const layout = s.layouts.get(s.selectedZone);
    if (!layout) {
      label(s.loading.has(s.selectedZone) ? 'Loading...' : 'No map for this zone', width / 2, height / 2, 'centre');
      return;
    }
    const { panel, viewport } = layout;
    ctx.fillStyle = MAP_COLORS.panel;
    ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
    ctx.strokeStyle = MAP_COLORS.border;
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);

    for (const [tx, ty] of layout.tiles) {
      const r = tileRect(viewport, tx, ty);
      ctx.fillStyle = MAP_COLORS.tile;
      ctx.fillRect(r.x, r.y, r.size, r.size);
      ctx.strokeStyle = MAP_COLORS.tileEdge;
      ctx.lineWidth = Math.max(1, scale / 2);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.size - 1, r.size - 1);
    }

    // The party, when this is the zone it is in.
    if (s.selectedZone === h.map?.zone) {
      const p = worldToMap(viewport, h.pose.x, h.pose.y);
      ctx.fillStyle = MAP_COLORS.arrow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(4 * scale, viewport.cell * 0.18), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = MAP_COLORS.arrowEdge;
      ctx.lineWidth = Math.max(1, scale);
      ctx.stroke();
    }

    label(`Zone ${s.selectedZone}: click a tile to go there`, layout.title.x, layout.title.y);
    label('F7 or Esc: close', panel.x + panel.width - 6 * scale, layout.title.y, 'right');
  }
}
