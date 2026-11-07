import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

/** Broadcast-style camera behind the viewer's goal that follows the ball, with shake and zoom. */
export class CameraRig {
  readonly camera = new PerspectiveCamera(50, 1, 0.5, 400);
  private readonly focus = new Vector3(0, 0, -4);
  private readonly desired = new Vector3();
  private height = 24;
  private back = 22;
  private zoom = 1;
  private targetZoom = 1;
  private shakeUntil = 0;
  private shakeStrength = 0;

  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;
    const portrait = aspect < 1;
    this.camera.fov = portrait ? 60 : 44;
    this.height = portrait ? 26 : 21;
    this.back = portrait ? 19 : 25;
    this.camera.updateProjectionMatrix();
  }

  shake(now: number, durationMs: number, strength: number): void {
    this.shakeUntil = now + durationMs;
    this.shakeStrength = strength;
  }

  setZoom(zoom: number): void {
    this.targetZoom = zoom;
  }

  update(dt: number, now: number, target: Vector3): void {
    this.desired.set(target.x * 0.4, 0, MathUtils.clamp(target.z, -15, 17));
    this.focus.lerp(this.desired, 1 - Math.exp(-dt * 2.2));
    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-dt * 2));

    this.camera.position.set(this.focus.x, this.height * this.zoom, this.focus.z - this.back * this.zoom);
    if (now < this.shakeUntil) {
      const s = this.shakeStrength * ((this.shakeUntil - now) / 600);
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.focus.x, 0, this.focus.z + 5);
  }
}
