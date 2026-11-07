import { CircleGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type BufferGeometry } from 'three';
import type { PlayerActor } from './PlayerActor';
import { createShadowTexture } from './textures';

const RADIUS = 0.3;

/**
 * A low-poly football. Subdividing an icosahedron's edges in three leaves a fan of five small
 * triangles around each of its 12 corners — exactly the pentagons of a truncated icosahedron,
 * the classic ball. Those fans are painted black, everything else white.
 */
function ballGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(RADIUS, 2);
  const corners: Vector3[] = [];
  const base = new IcosahedronGeometry(1, 0).getAttribute('position');
  for (let i = 0; i < base.count; i++) {
    const v = new Vector3().fromBufferAttribute(base, i).normalize();
    if (!corners.some(c => c.distanceToSquared(v) < 1e-6)) corners.push(v);
  }
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const v = new Vector3();
  for (let tri = 0; tri < position.count; tri += 3) {
    let touchesCorner = false;
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(position, tri + k).normalize();
      if (corners.some(c => c.distanceToSquared(v) < 1e-6)) touchesCorner = true;
    }
    const shade = touchesCorner ? 0.012 : 0.9;
    for (let k = 0; k < 3; k++) colors.set([shade, shade, shade], (tri + k) * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

interface Flight {
  from: Vector3;
  to: Vector3;
  start: number;
  duration: number;
  height: number;
  /** Optional curve: lateral bend at mid-flight, in metres. */
  bend: number;
}

export type BallControl = 'feet' | 'hands';

/** The ball: dribbled at a player's feet, or flying along an arc between two points. */
export class BallActor {
  readonly group = new Group();
  private readonly mesh: Mesh;
  private readonly shadow: Mesh;
  private owner: PlayerActor | null = null;
  private control: BallControl = 'feet';
  private readonly controlOffset = new Vector3();
  private flight: Flight | null = null;
  private fallSpeed = 0;
  private readonly tmp = new Vector3();
  private motion = 0;

  constructor() {
    this.mesh = new Mesh(ballGeometry(), new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.45 }));
    this.mesh.castShadow = true;
    this.shadow = new Mesh(new CircleGeometry(0.4, 12), new MeshBasicMaterial({ map: createShadowTexture(), transparent: true, opacity: 0.6, depthWrite: false }));
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

  /** Identifies a particular kick, so an old reception cannot steal a newer shot. */
  get motionId(): number {
    return this.motion;
  }

  /** Where the ball will be when its current flight lands. */
  destination(out = new Vector3()): Vector3 {
    return this.flight ? out.copy(this.flight.to) : out.copy(this.position);
  }

  /** Control is only possible at contact. Blend the last few centimetres into the attachment. */
  giveTo(actor: PlayerActor, control: BallControl = 'feet'): boolean {
    const point = this.controlPoint(actor, control, this.tmp);
    if (this.inFlight || this.position.distanceTo(point) > 1.25) return false;
    this.owner = actor;
    this.control = control;
    this.controlOffset.subVectors(this.position, point);
    this.flight = null;
    this.fallSpeed = 0;
    this.motion++;
    return true;
  }

  place(point: Vector3): void {
    this.owner = null;
    this.flight = null;
    this.fallSpeed = 0;
    this.position.set(point.x, Math.max(RADIUS, point.y), point.z);
    this.motion++;
  }

  /** Stops play at the ball's actual position, including an interrupted flight. */
  stop(): void {
    this.place(this.position);
  }

  /** Kicks the ball from where it is now to `to` over `durationMs`, with an arc of `height` metres. */
  kick(to: Vector3, now: number, durationMs: number, height = 0, bend = 0): void {
    this.owner = null;
    this.fallSpeed = 0;
    this.motion++;
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
    const prevX = this.position.x;
    const prevZ = this.position.z;
    if (this.flight) {
      const f = this.flight;
      const t = now >= f.start + f.duration ? 1 : MathUtils.clamp((now - f.start) / f.duration, 0, 1);
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
        this.flight = null;
      }
    } else if (this.owner) {
      this.controlPoint(this.owner, this.control, this.position);
      this.controlOffset.multiplyScalar(Math.exp(-dt * 16));
      this.position.add(this.controlOffset);
    } else if (this.position.y > RADIUS) {
      this.fallSpeed += dt * 9.8;
      this.position.y = Math.max(RADIUS, this.position.y - this.fallSpeed * dt);
    }

    // Roll the ball in the direction of travel.
    const dx = this.position.x - prevX;
    const dz = this.position.z - prevZ;
    this.mesh.rotation.x += dz / RADIUS;
    this.mesh.rotation.z -= dx / RADIUS;
    this.shadow.position.set(this.position.x, 0.012, this.position.z);
    const scale = 1 / (1 + (this.position.y - RADIUS) * 0.25);
    this.shadow.scale.setScalar(scale);
  }

  private controlPoint(actor: PlayerActor, control: BallControl, out: Vector3): Vector3 {
    if (control === 'hands') return actor.hands(out);
    return actor.feet(out).setY(RADIUS);
  }
}
