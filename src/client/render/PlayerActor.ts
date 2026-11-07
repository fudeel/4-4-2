import {
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { Side } from '../../shared/model/match';
import { surname, type PlayerProfile } from '../../shared/model/player';
import { createLabelTexture, createShadowTexture } from './textures';

export type Pose = 'stand' | 'fallen' | 'dive' | 'celebrate';

export interface Kit {
  shirt: string;
  shorts: string;
  socks: string;
}

const SKIN_TONES = ['#f1c7a5', '#d9a47c', '#b07a52', '#8a5a3b', '#5e3b26', '#e6b993'];
const HAIR_COLORS = ['#1c1410', '#3b2414', '#6b4423', '#c9a15b', '#111111', '#7a3b1d'];
const SCALE = 1.35;

/** Geometries are shared by every player to keep memory and draw setup low on phones. */
const GEO = {
  leg: new CylinderGeometry(0.085, 0.07, 0.78, 6),
  boot: new CylinderGeometry(0.08, 0.09, 0.12, 6),
  shorts: new CylinderGeometry(0.23, 0.21, 0.3, 8),
  torso: new CapsuleGeometry(0.21, 0.42, 4, 8),
  arm: new CapsuleGeometry(0.055, 0.42, 3, 6),
  head: new SphereGeometry(0.15, 12, 10),
  hair: new SphereGeometry(0.158, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  shadow: new CircleGeometry(0.55, 16),
  ring: new RingGeometry(0.62, 0.78, 32),
};
let shadowMaterial: MeshBasicMaterial | null = null;

function hashCode(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A stylised low-poly footballer that runs to targets and can fall, dive and celebrate. */
export class PlayerActor {
  readonly group = new Group();
  readonly target = new Vector3();
  /** Until this time (ms) the director's choreography owns the target, not the team shape. */
  scriptedUntil = 0;
  readonly seed: number;
  private readonly rig = new Group();
  private readonly hips = new Group();
  private readonly legs: Group[] = [];
  private readonly arms: Group[] = [];
  private readonly ring: Mesh;
  private readonly numberTag: Sprite;
  private readonly nameTag: Sprite;
  private runPhase = 0;
  private moving = 0;
  private pose: Pose = 'stand';
  private poseUntil = 0;
  private poseDirection = 1;
  private poseStart = 0;
  private readonly speed: number;

  constructor(
    readonly profile: PlayerProfile,
    readonly side: Side,
    kit: Kit,
    teamColor: string,
  ) {
    this.seed = hashCode(profile.id);
    this.speed = 5.5 + profile.attributes.pace / 22;
    const skin = new MeshLambertMaterial({ color: SKIN_TONES[this.seed % SKIN_TONES.length] });
    const hair = new MeshLambertMaterial({ color: HAIR_COLORS[(this.seed >> 3) % HAIR_COLORS.length] });
    const shirt = new MeshLambertMaterial({ color: kit.shirt });
    const shorts = new MeshLambertMaterial({ color: kit.shorts });
    const socks = new MeshLambertMaterial({ color: kit.socks });
    const boots = new MeshLambertMaterial({ color: '#111111' });

    this.hips.position.y = 0.86;
    for (const side of [-1, 1]) {
      const leg = new Group();
      leg.position.x = side * 0.11;
      const limb = new Mesh(GEO.leg, socks);
      limb.position.y = -0.39;
      const boot = new Mesh(GEO.boot, boots);
      boot.position.set(0, -0.8, 0.04);
      leg.add(limb, boot);
      this.legs.push(leg);
      this.hips.add(leg);
    }
    const shortsMesh = new Mesh(GEO.shorts, shorts);
    this.hips.add(shortsMesh);

    const torso = new Mesh(GEO.torso, shirt);
    torso.position.y = 1.3;
    torso.scale.set(1.15, 1, 0.8);
    for (const side of [-1, 1]) {
      const arm = new Group();
      arm.position.set(side * 0.29, 1.5, 0);
      const limb = new Mesh(GEO.arm, shirt);
      limb.position.y = -0.25;
      arm.add(limb);
      this.arms.push(arm);
    }
    const head = new Mesh(GEO.head, skin);
    head.position.y = 1.8;
    const hairMesh = new Mesh(GEO.hair, hair);
    hairMesh.position.y = 1.82;

    this.rig.add(this.hips, torso, head, hairMesh, ...this.arms);
    this.rig.scale.setScalar(SCALE);

    shadowMaterial ??= new MeshBasicMaterial({ map: createShadowTexture(), transparent: true, depthWrite: false });
    const shadow = new Mesh(GEO.shadow, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;

    this.ring = new Mesh(GEO.ring, new MeshBasicMaterial({ color: new Color(teamColor).offsetHSL(0, 0, 0.15), transparent: true, opacity: 0.95, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.visible = false;

    const number = createLabelTexture(String(profile.number), teamColor, '#ffffff');
    this.numberTag = new Sprite(new SpriteMaterial({ map: number.texture, depthWrite: false }));
    this.numberTag.scale.set(0.75 * number.aspect, 0.75, 1);
    this.numberTag.position.y = 3.05;

    const name = createLabelTexture(`${profile.number} ${surname(profile.name).toUpperCase()}`, teamColor, '#ffffff');
    this.nameTag = new Sprite(new SpriteMaterial({ map: name.texture, depthWrite: false }));
    this.nameTag.scale.set(0.85 * name.aspect, 0.85, 1);
    this.nameTag.position.y = 3.1;
    this.nameTag.visible = false;
    this.nameTag.renderOrder = 10;

    this.group.add(this.rig, shadow, this.ring, this.numberTag, this.nameTag);
  }

  get id(): string {
    return this.profile.id;
  }

  get position(): Vector3 {
    return this.group.position;
  }

  /** Point just in front of the player's feet, where a dribbled ball sits. */
  feet(out = new Vector3()): Vector3 {
    const angle = this.group.rotation.y;
    return out.set(this.position.x + Math.sin(angle) * 0.6, 0, this.position.z + Math.cos(angle) * 0.6);
  }

  moveTo(point: Vector3, now: number, scriptedForMs = 0): void {
    this.target.copy(point);
    this.target.y = 0;
    if (scriptedForMs > 0) this.scriptedUntil = Math.max(this.scriptedUntil, now + scriptedForMs);
  }

  teleport(point: Vector3): void {
    this.position.set(point.x, 0, point.z);
    this.target.copy(this.position);
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
    let speed = 0;
    if (this.pose !== 'fallen' && distance > 0.05) {
      speed = Math.min(this.speed, distance * 3);
      const step = Math.min(distance, speed * dt);
      this.position.x += (dx / distance) * step;
      this.position.z += (dz / distance) * step;
    }
    this.moving += ((speed > 0.4 ? Math.min(1, speed / 5) : 0) - this.moving) * Math.min(1, dt * 8);

    // Face where we're running, otherwise watch the ball.
    const faceX = this.moving > 0.2 ? dx : lookAt.x - this.position.x;
    const faceZ = this.moving > 0.2 ? dz : lookAt.z - this.position.z;
    if (Math.abs(faceX) + Math.abs(faceZ) > 0.01) {
      const desired = Math.atan2(faceX, faceZ);
      let delta = desired - this.group.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.group.rotation.y += delta * Math.min(1, dt * 10);
    }

    this.animate(dt, now);
  }

  private animate(dt: number, now: number): void {
    this.rig.rotation.z = 0;
    this.runPhase += dt * (6 + this.moving * 8);
    const swing = Math.sin(this.runPhase) * 0.75 * this.moving;
    this.legs[0]!.rotation.x = swing;
    this.legs[1]!.rotation.x = -swing;
    this.arms[0]!.rotation.set(-swing * 0.8, 0, 0.08);
    this.arms[1]!.rotation.set(swing * 0.8, 0, -0.08);
    this.rig.position.set(0, Math.abs(Math.sin(this.runPhase)) * 0.07 * this.moving, 0);
    this.rig.rotation.set(this.moving * 0.12, 0, 0);

    const t = Math.min(1, (now - this.poseStart) / 220);
    switch (this.pose) {
      case 'fallen':
        this.rig.rotation.x = -Math.PI / 2.1 * t;
        this.rig.position.y = 0.25 * t;
        break;
      case 'dive':
        this.rig.rotation.z = (-Math.PI / 2.3) * t * this.poseDirection;
        this.rig.position.y = 0.55 * Math.sin(t * Math.PI * 0.8);
        break;
      case 'celebrate': {
        const jump = Math.abs(Math.sin((now - this.poseStart) / 140));
        this.rig.position.y = jump * 0.45;
        this.arms[0]!.rotation.set(0, 0, -2.6);
        this.arms[1]!.rotation.set(0, 0, 2.6);
        break;
      }
      default:
        break;
    }
  }
}
