import type { PerspectiveCamera } from 'three/webgpu';

/**
 * Development camera: click to capture the mouse, WASD to move, Q/E down/up,
 * Shift to move faster. Will be replaced by the party movement controller.
 */
export class FlyCamera {
  speed = 2000; // world units per second
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();

  constructor(
    private readonly camera: PerspectiveCamera,
    element: HTMLElement,
  ) {
    element.addEventListener('click', () => element.requestPointerLock());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== element) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.0025));
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setHeading(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  update(dt: number): void {
    const k = this.keys;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 5 : 1;
    const step = this.speed * fast * dt;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const p = this.camera.position;
    if (k.has('KeyW')) { p.x += fx * step; p.z += fz * step; }
    if (k.has('KeyS')) { p.x -= fx * step; p.z -= fz * step; }
    if (k.has('KeyA')) { p.x += fz * step; p.z -= fx * step; }
    if (k.has('KeyD')) { p.x -= fz * step; p.z += fx * step; }
    if (k.has('KeyE')) p.y += step;
    if (k.has('KeyQ')) p.y -= step;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
