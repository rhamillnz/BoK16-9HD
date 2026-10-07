import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createSky, FOG_FAR, FOG_NEAR } from '../src/render/sky';
import { installUnderground } from '../src/game/undergroundMode';
import { MINE_LOOK, isUndergroundZone, speedScaleForZone, torchFlicker, undergroundModelName, undergroundTableName } from '../src/world/underground';
import { PartyController, WALK_SPEED } from '../src/world/partyController';

describe('underground zones', () => {
  it('treats zones 10-12 as mines', () => {
    expect([1, 9, 10, 11, 12, 13].map(isUndergroundZone)).toEqual([false, false, true, true, true, false]);
    expect(speedScaleForZone(11)).toBe(0.5);
    expect(speedScaleForZone(3)).toBe(1);
    expect(undergroundTableName('Z10')).toBe('Z10M.TBL');
    expect(undergroundModelName('m_door')).toBe('m_door_ug');
  });

  it('keeps the lantern flicker within a gentle band', () => {
    for (let t = 0; t < 30; t += 0.1) expect(torchFlicker(t)).toBeGreaterThan(0.89);
    for (let t = 0; t < 30; t += 0.1) expect(torchFlicker(t)).toBeLessThan(1.11);
  });

  it('swaps the sky for cave lighting and back', () => {
    const scene = new THREE.Scene();
    const sky = createSky(scene);
    const torch = scene.children.find((o): o is THREE.PointLight => o instanceof THREE.PointLight)!;
    const key = scene.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight)!;
    const fog = scene.fog as THREE.Fog;
    const dome = scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh)!;
    sky.update(12 * 60);
    expect(torch.visible).toBe(false);

    sky.setUnderground(true);
    sky.update(12 * 60); // the clock keeps ticking below ground; it must not relight the sun
    sky.followShadow(5, 1, -7);
    expect(dome.visible).toBe(false);
    expect(key.intensity).toBe(0);
    expect(key.castShadow).toBe(false);
    expect([fog.near, fog.far]).toEqual([MINE_LOOK.fogNear, MINE_LOOK.fogFar]);
    expect(torch.visible).toBe(true);
    expect(torch.position.toArray()).toEqual([5, 1, -7]);
    expect(torch.intensity).toBeGreaterThan(0);

    sky.setUnderground(false);
    expect(dome.visible).toBe(true);
    expect(torch.visible).toBe(false);
    expect([fog.near, fog.far]).toEqual([FOG_NEAR, FOG_FAR]);
    expect(key.intensity).toBeGreaterThan(2);
    expect(key.castShadow).toBe(true);
  });

  it('widens the lantern while a light spell is active', () => {
    const scene = new THREE.Scene();
    const sky = createSky(scene);
    const update = installUnderground(sky, new PartyController());
    const torch = scene.children.find((o): o is THREE.PointLight => o instanceof THREE.PointLight)!;
    update(10, false);
    sky.followShadow(0, 0, 0);
    const plain = torch.intensity;
    update(10, true);
    sky.followShadow(0, 0, 0);
    expect(torch.distance).toBeCloseTo(MINE_LOOK.torchDistance * MINE_LOOK.magicReach);
    expect(torch.intensity).toBeGreaterThan(plain * 1.5);
    update(10, false);
    expect(torch.distance).toBe(MINE_LOOK.torchDistance);
  });

  it('halves walking speed in mines when the zone changes', () => {
    const scene = new THREE.Scene();
    const sky = createSky(scene);
    const party = new PartyController(0, 0, 0);
    const update = installUnderground(sky, party);
    const walk = () => {
      party.setPosition(0, 0, 0);
      party.update(1, { forward: true, back: false, turnLeft: false, turnRight: false, run: false });
      return Math.hypot(party.x, party.y);
    };
    update(1);
    expect(walk()).toBeCloseTo(WALK_SPEED);
    update(10);
    expect(walk()).toBeCloseTo(WALK_SPEED / 2);
    update(1);
    expect(walk()).toBeCloseTo(WALK_SPEED);
  });
});
