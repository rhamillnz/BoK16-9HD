import { type MapLayout, type PartyPose, layoutMap, MAP_COLORS } from './mapScreen';
import { type MapViewport } from './mapMath';
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
  _height: number,
  buttonHeight: number = 24,
): { x: number; y: number; width: number; height: number }[] {
  const topMargin = 8;
  const sideMargin = 12;
  const spacing = 4;
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
      const layout = layoutMap(map, this.host.width, this.host.height);
      // Adjust layout to account for zone buttons at the top
      const buttonAreaHeight = s.buttons[0]!.height + s.buttons[0]!.y + 8;
      s.layouts.set(zone, {
        ...layout,
        panel: {
          ...layout.panel,
          y: layout.panel.y + buttonAreaHeight,
          height: Math.max(20, layout.panel.height - buttonAreaHeight),
        },
        title: {
          ...layout.title,
          y: layout.title.y + buttonAreaHeight,
        },
      });
      this.host.invalidate();
    } finally {
      s.loading.delete(zone);
    }
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
      const buttonAreaHeight = s.buttons[0]!.height + s.buttons[0]!.y + 8;
      if (ev.y < buttonAreaHeight) return; // Click is in the button area but not on a button

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
    const { width, height } = h;

    // Draw background
    ctx.fillStyle = MAP_COLORS.backdrop;
    ctx.fillRect(0, 0, width, height);

    // Draw zone buttons
    for (let i = 0; i < s.buttons.length; i++) {
      const btn = s.buttons[i]!;
      const isSelected = s.selectedZone === i + 1;

      ctx.fillStyle = isSelected ? MAP_COLORS.tileEdge : MAP_COLORS.tile;
      ctx.fillRect(btn.x, btn.y, btn.width, btn.height);
      ctx.strokeStyle = MAP_COLORS.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(btn.x, btn.y, btn.width, btn.height);

      // Draw zone number text
      ctx.fillStyle = MAP_COLORS.text;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}`, btn.x + btn.width / 2, btn.y + btn.height / 2);
    }

    // Draw map for selected zone if loaded
    const layout = s.layouts.get(s.selectedZone);
    if (layout) {
      const isCurrentZone = s.selectedZone === (h.map?.zone ?? 0);
      const pose: PartyPose = isCurrentZone ? h.pose : { x: -999999, y: -999999, heading: 0 };

      // Draw the map panel background and border
      const { scale, panel } = layout;
      ctx.fillStyle = MAP_COLORS.panel;
      ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
      ctx.strokeStyle = MAP_COLORS.border;
      ctx.lineWidth = 2 * scale;
      ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);

      // Draw tiles
      for (const [tx, ty] of layout.tiles) {
        const { x, y, size } = (() => {
          const { bounds, cell, originX, originY } = layout.viewport;
          const rows = bounds.maxY - bounds.minY + 1;
          const p = { x: originX + (tx - bounds.minX) * cell, y: originY + (rows - (ty - bounds.minY)) * cell };
          return { x: p.x, y: p.y, size: cell };
        })();

        ctx.fillStyle = MAP_COLORS.tile;
        ctx.fillRect(x, y, size, size);
        ctx.strokeStyle = MAP_COLORS.tileEdge;
        ctx.lineWidth = Math.max(1, scale / 2);
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      }

      // Draw party position if in current zone
      if (isCurrentZone) {
        const { x, y } = (() => {
          const { bounds, cell, originX, originY } = layout.viewport;
          const rows = bounds.maxY - bounds.minY + 1;
          return {
            x: originX + (pose.x / TILE_SIZE - bounds.minX) * cell,
            y: originY + (rows - (pose.y / TILE_SIZE - bounds.minY)) * cell,
          };
        })();

        const size = Math.max(6 * scale, layout.viewport.cell * 0.35);
        ctx.fillStyle = MAP_COLORS.arrow;
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = MAP_COLORS.arrowEdge;
        ctx.lineWidth = Math.max(1, scale);
        ctx.stroke();
      }

      // Draw zone title
      ctx.fillStyle = MAP_COLORS.text;
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`Zone ${s.selectedZone}`, layout.title.x, layout.title.y);
    } else {
      // Show loading or unloaded message
      const loading = s.loading.has(s.selectedZone);
      ctx.fillStyle = MAP_COLORS.text;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(loading ? 'Loading...' : 'Click to load', width / 2, height / 2);
    }

    // Draw hint text
    ctx.fillStyle = MAP_COLORS.text;
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('F7 or Esc: close', width - 12, 8);
  }
}
