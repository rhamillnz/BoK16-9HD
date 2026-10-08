import type { PerspectiveCamera } from 'three/webgpu';

/**
 * Debug fly camera: while enabled, click to capture the mouse and look around. W/S (or Up/Down) fly
 * along the view direction, so looking up and pressing W climbs; A/D (or Left/Right)
 * strafe; Space or E rises, Ctrl or Q sinks; Shift moves 5x faster.
 */
export class FlyCamera {
  speed = 2000; // world units per second
  /** Only capture the mouse while the fly camera is in use; otherwise HUD screens need the cursor. */
  enabled = false;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();

  constructor(
    private readonly camera: PerspectiveCamera,
    element: HTMLElement,
  ) {
    element.addEventListener('click', () => {
      if (this.enabled) void element.requestPointerLock();
    });
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
    const has = (...codes: string[]) => codes.some((c) => k.has(c));
    const fast = has('ShiftLeft', 'ShiftRight') ? 5 : 1;
    const step = this.speed * fast * dt;
    const cp = Math.cos(this.pitch);
    // View direction (includes pitch) and the horizontal right vector.
    const fx = -Math.sin(this.yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * cp;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const p = this.camera.position;
    const move = (dx: number, dy: number, dz: number, s: number) => {
      p.x += dx * s;
      p.y += dy * s;
      p.z += dz * s;
    };
    if (has('KeyW', 'ArrowUp')) move(fx, fy, fz, step);
    if (has('KeyS', 'ArrowDown')) move(fx, fy, fz, -step);
    if (has('KeyD', 'ArrowRight')) move(rx, 0, rz, step);
    if (has('KeyA', 'ArrowLeft')) move(rx, 0, rz, -step);
    if (has('Space', 'KeyE')) p.y += step;
    if (has('ControlLeft', 'ControlRight', 'KeyQ')) p.y -= step;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
