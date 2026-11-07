import { CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, Vector3 } from 'three';
import type { PlayerActor } from './PlayerActor';
import { createBallTexture, createShadowTexture } from './textures';

const RADIUS = 0.3;

interface Flight {
  from: Vector3;
  to: Vector3;
  start: number;
  duration: number;
  height: number;
  /** Optional curve: lateral bend at mid-flight, in metres. */
  bend: number;
}

/** The ball: dribbled at a player's feet, or flying along an arc between two points. */
export class BallActor {
  readonly group = new Group();
  private readonly mesh: Mesh;
  private readonly shadow: Mesh;
  private owner: PlayerActor | null = null;
  private flight: Flight | null = null;
  private readonly velocity = new Vector3();
  private readonly tmp = new Vector3();

  constructor() {
    this.mesh = new Mesh(new SphereGeometry(RADIUS, 16, 12), new MeshLambertMaterial({ map: createBallTexture() }));
    this.shadow = new Mesh(new CircleGeometry(0.4, 12), new MeshBasicMaterial({ map: createShadowTexture(), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.group.add(this.mesh);
    this.mesh.position.y = RADIUS;
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  get shadowMesh(): Mesh {
    return this.shadow;
  }

  get holder(): PlayerActor | null {
    return this.owner;
  }

  get inFlight(): boolean {
    return this.flight !== null;
  }

  /** Where the ball will be when its current flight lands. */
  destination(out = new Vector3()): Vector3 {
    return this.flight ? out.copy(this.flight.to) : this.owner ? this.owner.feet(out) : out.copy(this.position);
  }

  giveTo(actor: PlayerActor): void {
    this.owner = actor;
    this.flight = null;
    this.velocity.set(0, 0, 0);
  }

  place(point: Vector3): void {
    this.owner = null;
    this.flight = null;
    this.velocity.set(0, 0, 0);
    this.position.set(point.x, Math.max(RADIUS, point.y), point.z);
  }

  /** Kicks the ball from where it is now to `to` over `durationMs`, with an arc of `height` metres. */
  kick(to: Vector3, now: number, durationMs: number, height = 0, bend = 0): void {
    this.owner = null;
    this.flight = {
      from: this.position.clone(),
      to: to.clone(),
      start: now,
      duration: Math.max(80, durationMs),
      height,
      bend,
    };
  }

  update(dt: number, now: number): void {
    const prev = this.tmp.copy(this.position);
    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (now - f.start) / f.duration);
      const eased = t + 0.3 * t * (1 - t); // leaves the boot fast, slows towards the end
      const p = f.from.clone().lerp(f.to, eased);
      const arc = 4 * f.height * t * (1 - t);
      p.y = Math.max(RADIUS, f.from.y * (1 - t) + f.to.y * t + arc);
      if (f.bend !== 0) {
        const dir = f.to.clone().sub(f.from);
        const side = new Vector3(-dir.z, 0, dir.x).normalize();
        p.addScaledVector(side, Math.sin(Math.PI * t) * f.bend);
      }
      this.position.copy(p);
      if (t >= 1) {
        this.velocity.copy(f.to).sub(f.from).multiplyScalar(1000 / f.duration).setY(0).multiplyScalar(0.15);
        this.flight = null;
      }
    } else if (this.owner) {
      this.owner.feet(this.position);
      this.position.y = RADIUS;
    } else if (this.velocity.lengthSq() > 0.001) {
      this.position.addScaledVector(this.velocity, dt);
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 1.8));
      this.position.y = Math.max(RADIUS, this.position.y - dt * 4);
    }

    // Roll the ball in the direction of travel.
    const dx = this.position.x - prev.x;
    const dz = this.position.z - prev.z;
    this.mesh.rotation.x += dz / RADIUS;
    this.mesh.rotation.z -= dx / RADIUS;
    this.shadow.position.set(this.position.x, 0.012, this.position.z);
    const scale = 1 / (1 + (this.position.y - RADIUS) * 0.25);
    this.shadow.scale.setScalar(scale);
  }
}
