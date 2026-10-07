import type { Sky } from '../render/sky';
import { isUndergroundZone, speedScaleForZone } from '../world/underground';
import type { PartyController } from '../world/partyController';

/**
 * Switches the look and feel for mine zones: no sky, a lantern light, half walking speed.
 * Call the returned function each frame with the current zone; it acts only when that changes.
 */
export function installUnderground(sky: Sky, party: Pick<PartyController, 'speedScale'>): (zone: number) => void {
  let current: number | undefined;
  return (zone) => {
    if (zone === current) return;
    current = zone;
    sky.setUnderground(isUndergroundZone(zone));
    party.speedScale = speedScaleForZone(zone);
  };
}
