import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createSky, FOG_FAR, FOG_NEAR } from '../src/render/sky';

describe('createSky', () => {
  it('installs fog and lights and updates them through the day', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xff00ff);
    const sky = createSky(scene);

    const key = scene.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight)!;
    const hemi = scene.children.find((o): o is THREE.HemisphereLight => o instanceof THREE.HemisphereLight)!;
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    const fog = scene.fog as THREE.Fog;
    expect([fog.near, fog.far]).toEqual([FOG_NEAR, FOG_FAR]);

    sky.update(12 * 60);
    const noonFog = fog.color.clone();
    expect(key.intensity).toBeGreaterThan(2);
    expect(key.position.y).toBeGreaterThan(0);

    sky.update(0);
    expect(fog.color.equals(noonFog)).toBe(false);
    expect(key.position.y).toBeGreaterThan(0); // moon is up at midnight
    expect(key.intensity).toBeGreaterThan(0.3);
    expect(hemi.intensity).toBeGreaterThan(0.7); // readable night
  });
});
