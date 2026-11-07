import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { Side } from '../../shared/model/match';
import { surname, type PlayerProfile } from '../../shared/model/player';
import { lowPolyMaterial, merge, paint } from './lowpoly';
import { createLabelTexture, createShadowTexture, createShirtNumberTexture } from './textures';

export type Pose = 'stand' | 'fallen' | 'dive' | 'celebrate' | 'header' | 'kick' | 'throw' | 'tackle';

export interface Kit {
  shirt: string;
  shorts: string;
  socks: string;
  /** Goalkeepers wear gloves; outfielders show their hands. */
  gloves?: string;
}

const SKIN_TONES = ['#f1c7a5', '#d9a47c', '#b07a52', '#8a5a3b', '#5e3b26', '#e6b993'];
const HAIR_COLORS = ['#1c1410', '#3b2414', '#6b4423', '#c9a15b', '#111111', '#7a3b1d'];
const BOOT_COLORS = ['#151515', '#f4f4f4', '#151515', '#ff5a1f', '#151515', '#2f6bff'];
const SCALE = 1.35;
/** Jogging speed as a fraction of a player's sprint speed. */
const JOG_FACTOR = 0.55;
/** Further than this from their spot (metres), players sprint back. */
const SPRINT_DISTANCE = 7;
/** How quickly players reach their desired speed (1/s). */
const ACCELERATION = 5;
/** Rotation that puts a flat face (not an edge) of a 6-sided cylinder at the front and back. */
const FLAT_FRONT = Math.PI / 6;

/** Geometries shared by every player (the painted, per-player parts are built per actor). */
const GEO = {
  shadow: new CircleGeometry(0.6, 16),
  ring: new RingGeometry(0.62, 0.78, 32),
  number: new PlaneGeometry(0.24, 0.24),
};
let shadowMaterial: MeshBasicMaterial | null = null;

function hashCode(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function part(geometry: BufferGeometry, color: string, place: (g: BufferGeometry) => void = () => undefined): BufferGeometry {
  place(geometry);
  return paint(geometry, color);
}

/** A head with one of a few low-poly haircuts. */
function headGeometry(skin: string, hair: string, style: number): BufferGeometry {
  const parts = [part(new IcosahedronGeometry(0.15, 1), skin)];
  switch (style % 5) {
    case 0: // short
      parts.push(part(new IcosahedronGeometry(0.162, 1), hair, g => g.scale(1, 0.62, 1).translate(0, 0.05, -0.012)));
      break;
    case 1: // buzz cut
      parts.push(part(new IcosahedronGeometry(0.155, 1), hair, g => g.scale(1, 0.5, 1).translate(0, 0.065, -0.005)));
      break;
    case 2: // curls
      parts.push(part(new IcosahedronGeometry(0.19, 1), hair, g => g.scale(1, 0.74, 1).translate(0, 0.07, -0.02)));
      break;
    case 3: // bun
      parts.push(part(new IcosahedronGeometry(0.162, 1), hair, g => g.scale(1, 0.62, 1).translate(0, 0.05, -0.012)));
      parts.push(part(new IcosahedronGeometry(0.07, 0), hair, g => g.translate(0, 0.12, -0.13)));
      break;
    default: // shaved
      break;
  }
  return merge(parts);
}

/**
 * A stylised low-poly footballer: flat-shaded, vertex-coloured, with knees and elbows so the run
 * cycle reads from the broadcast camera. Runs to targets and can fall, dive and celebrate.
 */
export class PlayerActor {
  readonly group = new Group();
  readonly target = new Vector3();
  /** Until this time (ms) the director's choreography owns the target, not the team shape. */
  scriptedUntil = 0;
  /** Until this time (ms) the player sprints back into shape (e.g. after losing the ball). */
  private hurryUntil = 0;
  readonly seed: number;
  private readonly rig = new Group();
  private readonly hips = new Group();
  private readonly torso: Mesh;
  private readonly thighs: Group[] = [];
  private readonly knees: Group[] = [];
  private readonly shoulders: Group[] = [];
  private readonly elbows: Group[] = [];
  private readonly ring: Mesh;
  private readonly numberTag: Sprite;
  private readonly nameTag: Sprite;
  private runPhase = 0;
  private moving = 0;
  private pose: Pose = 'stand';
  private poseUntil = 0;
  private poseDirection = 1;
  private poseStart = 0;
  /** Top (sprint) speed in m/s; players jog at a fraction of it when there's no hurry. */
  private readonly speed: number;
  private readonly velocity = new Vector3();
  private arrival: { from: Vector3; start: number; end: number } | null = null;
  private readonly keeperKit: boolean;

  constructor(
    readonly profile: PlayerProfile,
    readonly side: Side,
    kit: Kit,
    teamColor: string,
  ) {
    this.keeperKit = !!kit.gloves;
    this.seed = hashCode(profile.id);
    this.speed = 5.5 + profile.attributes.pace / 22;
    const skin = SKIN_TONES[this.seed % SKIN_TONES.length]!;
    const hair = HAIR_COLORS[(this.seed >> 3) % HAIR_COLORS.length]!;
    const boots = BOOT_COLORS[(this.seed >> 5) % BOOT_COLORS.length]!;
    const material = lowPolyMaterial();
    const mesh = (geometry: BufferGeometry) => {
      const m = new Mesh(geometry, material);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    // Legs: hip → thigh (skin) → knee → shin (sock) + boot.
    this.hips.position.y = 0.88;
    for (const side of [-1, 1]) {
      const thigh = new Group();
      thigh.position.x = side * 0.1;
      thigh.add(mesh(part(new CylinderGeometry(0.088, 0.07, 0.42, 6), skin, g => g.translate(0, -0.21, 0))));
      const knee = new Group();
      knee.position.y = -0.42;
      knee.add(mesh(merge([
        part(new CylinderGeometry(0.072, 0.055, 0.4, 6), kit.socks, g => g.translate(0, -0.2, 0)),
        part(new BoxGeometry(0.115, 0.085, 0.25), boots, g => g.translate(0, -0.42, 0.045)),
      ])));
      thigh.add(knee);
      this.thighs.push(thigh);
      this.knees.push(knee);
      this.hips.add(thigh);
    }
    this.hips.add(mesh(part(new CylinderGeometry(0.22, 0.26, 0.3, 6, 1, false, FLAT_FRONT), kit.shorts, g => g.translate(0, -0.03, 0))));

    // Torso (tapered, flattened) with the neck, and the shirt number on the back.
    this.torso = mesh(merge([
      part(new CylinderGeometry(0.28, 0.21, 0.58, 6, 1, false, FLAT_FRONT), kit.shirt, g => g.scale(1, 1, 0.68).translate(0, 1.24, 0)),
      part(new CylinderGeometry(0.065, 0.075, 0.14, 5), skin, g => g.translate(0, 1.58, 0)),
    ]));
    const number = new Mesh(GEO.number, new MeshBasicMaterial({ map: createShirtNumberTexture(profile.number, kit.shorts), transparent: true, side: DoubleSide, depthWrite: false }));
    number.position.set(0, 1.3, -0.165);
    number.rotation.y = Math.PI;

    const head = mesh(headGeometry(skin, hair, this.seed >> 7));
    head.position.y = 1.76;

    // Arms: shoulder → sleeve (shirt) → elbow → forearm + hand (skin, or gloves for keepers).
    for (const side of [-1, 1]) {
      const shoulder = new Group();
      shoulder.position.set(side * 0.32, 1.47, 0);
      shoulder.add(mesh(part(new CylinderGeometry(0.078, 0.062, 0.28, 5), kit.shirt, g => g.translate(0, -0.14, 0))));
      const elbow = new Group();
      elbow.position.y = -0.28;
      elbow.add(mesh(merge([
        part(new CylinderGeometry(0.056, 0.046, 0.24, 5), skin, g => g.translate(0, -0.12, 0)),
        part(new IcosahedronGeometry(kit.gloves ? 0.075 : 0.055, 0), kit.gloves ?? skin, g => g.translate(0, -0.27, 0)),
      ])));
      shoulder.add(elbow);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
    }

    this.rig.add(this.hips, this.torso, number, head, ...this.shoulders);
    this.rig.scale.setScalar(SCALE);

    shadowMaterial ??= new MeshBasicMaterial({ map: createShadowTexture(), transparent: true, opacity: 0.55, depthWrite: false });
    const contactShadow = new Mesh(GEO.shadow, shadowMaterial);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.015;

    this.ring = new Mesh(GEO.ring, new MeshBasicMaterial({ color: new Color(teamColor).offsetHSL(0, 0, 0.15), transparent: true, opacity: 0.95, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.visible = false;

    const tag = createLabelTexture(String(profile.number), teamColor, '#ffffff');
    this.numberTag = new Sprite(new SpriteMaterial({ map: tag.texture, depthWrite: false }));
    this.numberTag.scale.set(0.7 * tag.aspect, 0.7, 1);
    this.numberTag.position.y = 3.1;

    const name = createLabelTexture(`${profile.number} ${surname(profile.name).toUpperCase()}`, teamColor, '#ffffff');
    this.nameTag = new Sprite(new SpriteMaterial({ map: name.texture, depthWrite: false }));
    this.nameTag.scale.set(0.85 * name.aspect, 0.85, 1);
    this.nameTag.position.y = 3.15;
    this.nameTag.visible = false;
    this.nameTag.renderOrder = 10;

    this.group.add(this.rig, contactShadow, this.ring, this.numberTag, this.nameTag);
  }

  get id(): string {
    return this.profile.id;
  }

  get isKeeper(): boolean {
    return this.keeperKit;
  }

  get position(): Vector3 {
    return this.group.position;
  }

  /** Point just in front of the player's feet, where a dribbled ball sits. */
  feet(out = new Vector3()): Vector3 {
    const angle = this.group.rotation.y;
    return out.set(this.position.x + Math.sin(angle) * 0.6, 0, this.position.z + Math.cos(angle) * 0.6);
  }

  hands(out = new Vector3()): Vector3 {
    return this.feet(out).setY(0.95);
  }

  /** Keep short event choreography within the ground this player can actually cover. */
  reachablePoint(point: Vector3, durationMs: number): Vector3 {
    const delta = point.clone().sub(this.position).setY(0);
    delta.clampLength(0, this.speed * Math.max(0, durationMs) / 1000 * 0.7);
    return delta.add(this.position).setY(0);
  }

  /** A timed run to a reachable contact point; reception and flight share this deadline. */
  arriveAt(point: Vector3, now: number, durationMs: number, holdMs = 250): void {
    this.target.copy(point).setY(0);
    this.arrival = { from: this.position.clone(), start: now, end: now + Math.max(1, durationMs) };
    this.scriptedUntil = this.arrival.end + holdMs;
    this.pose = 'stand';
  }

  moveTo(point: Vector3, now: number, scriptedForMs = 0): void {
    this.arrival = null;
    this.target.copy(point);
    this.target.y = 0;
    if (scriptedForMs > 0) this.scriptedUntil = Math.max(this.scriptedUntil, now + scriptedForMs);
  }

  /** Sprint (rather than jog) back into position until `until` (ms). */
  hurry(until: number): void {
    this.hurryUntil = Math.max(this.hurryUntil, until);
  }

  teleport(point: Vector3): void {
    this.arrival = null;
    this.pose = 'stand';
    this.position.set(point.x, 0, point.z);
    this.target.copy(this.position);
    this.velocity.set(0, 0, 0);
  }

  setHighlighted(on: boolean): void {
    this.ring.visible = on;
    this.nameTag.visible = on;
    this.numberTag.visible = !on;
  }

  setPose(pose: Pose, now: number, durationMs: number, direction = 1): void {
    this.pose = pose;
    this.poseStart = now;
    this.poseUntil = now + durationMs;
    this.poseDirection = direction;
  }

  update(dt: number, now: number, lookAt: Vector3): void {
    if (this.pose !== 'stand' && now > this.poseUntil) this.pose = 'stand';

    const dx = this.target.x - this.position.x;
    const dz = this.target.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    // Sprint when it matters (a scripted run, or far out of position); otherwise jog,
    // easing in so players settle on their spot instead of overshooting it.
    let desired = 0;
    if (this.pose !== 'fallen' && distance > 0.05) {
      const urgent = now < this.scriptedUntil || now < this.hurryUntil || distance > SPRINT_DISTANCE;
      desired = Math.min(urgent ? this.speed : this.speed * JOG_FACTOR, distance * 2.2);
    }
    const ax = distance > 0.05 ? (dx / distance) * desired : 0;
    const az = distance > 0.05 ? (dz / distance) * desired : 0;
    const blend = 1 - Math.exp(-dt * ACCELERATION);
    this.velocity.x += (ax - this.velocity.x) * blend;
    this.velocity.z += (az - this.velocity.z) * blend;
    if (this.pose === 'fallen') this.velocity.set(0, 0, 0);
    if (this.arrival) {
      const arrival = this.arrival;
      const t = now >= arrival.end ? 1 : Math.max(0, (now - arrival.start) / (arrival.end - arrival.start));
      const before = this.position.clone();
      this.position.copy(arrival.from).lerp(this.target, t);
      this.velocity.subVectors(this.position, before).divideScalar(Math.max(dt, 0.001));
      if (t >= 1) {
        this.arrival = null;
        this.velocity.set(0, 0, 0);
      }
    } else {
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.moving += ((speed > 0.4 ? Math.min(1, speed / 6) : 0) - this.moving) * Math.min(1, dt * 8);

    // Face where we're running, otherwise watch the ball.
    const faceX = this.moving > 0.2 ? this.velocity.x : lookAt.x - this.position.x;
    const faceZ = this.moving > 0.2 ? this.velocity.z : lookAt.z - this.position.z;
    if (Math.abs(faceX) + Math.abs(faceZ) > 0.01) {
      const desiredAngle = Math.atan2(faceX, faceZ);
      let delta = desiredAngle - this.group.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.group.rotation.y += delta * Math.min(1, dt * 10);
    }

    this.animate(dt, now);
  }

  private animate(dt: number, now: number): void {
    const m = this.moving;
    this.runPhase += dt * (6 + m * 8);
    const p = this.runPhase;
    const swing = Math.sin(p) * 0.8 * m;

    // Run cycle: thighs swing, knees fold on the way through, arms pump against the legs.
    this.thighs[0]!.rotation.set(swing, 0, 0);
    this.thighs[1]!.rotation.set(-swing, 0, 0);
    this.knees[0]!.rotation.x = 0.08 + Math.max(0, Math.sin(p - 0.45)) * 1.4 * m;
    this.knees[1]!.rotation.x = 0.08 + Math.max(0, Math.sin(p - 0.45 + Math.PI)) * 1.4 * m;
    this.shoulders[0]!.rotation.set(-swing * 0.9, 0, -0.12);
    this.shoulders[1]!.rotation.set(swing * 0.9, 0, 0.12);
    this.elbows[0]!.rotation.x = -(0.3 + 0.9 * m);
    this.elbows[1]!.rotation.x = -(0.3 + 0.9 * m);
    this.rig.position.set(0, Math.abs(Math.sin(p)) * 0.06 * m, 0);
    this.rig.rotation.set(m * 0.14, 0, 0);
    // Breathing while standing.
    this.torso.scale.y = 1 + Math.sin(now / 650 + this.seed) * 0.012 * (1 - m);

    const t = Math.min(1, (now - this.poseStart) / 220);
    switch (this.pose) {
      case 'fallen':
        this.rig.rotation.x = (-Math.PI / 2.1) * t;
        this.rig.position.y = 0.22 * t;
        this.knees[0]!.rotation.x = this.knees[1]!.rotation.x = 0.4 * t;
        break;
      case 'dive':
        this.rig.rotation.z = (-Math.PI / 2.3) * t * this.poseDirection;
        this.rig.position.y = 0.55 * Math.sin(t * Math.PI * 0.8);
        // Full stretch: arms reach out over the head.
        this.shoulders[0]!.rotation.set(0, 0, -2.7 * t);
        this.shoulders[1]!.rotation.set(0, 0, 2.7 * t);
        this.elbows[0]!.rotation.x = this.elbows[1]!.rotation.x = 0;
        break;
      case 'celebrate': {
        const jump = Math.abs(Math.sin((now - this.poseStart) / 140));
        this.rig.position.y = jump * 0.45;
        this.knees[0]!.rotation.x = this.knees[1]!.rotation.x = (1 - jump) * 0.7;
        this.shoulders[0]!.rotation.set(0, 0, -2.6);
        this.shoulders[1]!.rotation.set(0, 0, 2.6);
        this.elbows[0]!.rotation.x = this.elbows[1]!.rotation.x = -0.2;
        break;
      }
      case 'header':
        this.rig.position.y = Math.sin(Math.min(1, (now - this.poseStart) / 420) * Math.PI) * 0.3;
        this.rig.rotation.x = 0.25 * Math.sin(t * Math.PI);
        break;
      case 'kick': {
        const strike = Math.sin(Math.min(1, (now - this.poseStart) / 280) * Math.PI);
        this.thighs[0]!.rotation.x = -strike;
        this.knees[0]!.rotation.x = 0.15;
        this.rig.rotation.x = -0.12 * strike;
        break;
      }
      case 'tackle':
        this.rig.rotation.x = -0.25 * t;
        this.rig.position.y = -0.2 * t;
        this.thighs[0]!.rotation.x = -1.2 * t;
        this.knees[0]!.rotation.x = 0.1;
        break;
      case 'throw':
        this.shoulders[0]!.rotation.x = this.shoulders[1]!.rotation.x = -1.6 * (1 - t);
        this.elbows[0]!.rotation.x = this.elbows[1]!.rotation.x = -0.3;
        break;
      default:
        break;
    }
  }
}
