import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import { flatMaterial } from '../lowpoly';
import { PITCH } from '../PitchSpace';

const DEPTH_GROUND = 1.6;
const DEPTH_TOP = 1.0;
/** Distance between net cords (metres). */
const MESH = 0.22;
const POST_RADIUS = 0.065;

interface NetVertex {
  base: Vector3;
  /** Direction the net bulges when it's hit. */
  normal: Vector3;
}

const UP = new Vector3(0, 1, 0);

/** A frame bar from `a` to `b`. */
function bar(a: Vector3, b: Vector3, radius: number, material: Material): Mesh {
  const length = a.distanceTo(b);
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
  mesh.castShadow = true;
  return mesh;
}

/**
 * A goal: white posts and crossbar, grey back supports and a net made of cords that sags under
 * its own weight and bulges when the ball hits it. Built facing +z (the net behind the line),
 * then turned around for the other end.
 */
export class Goal {
  readonly group = new Group();
  private readonly vertices: NetVertex[] = [];
  private readonly positions: Float32Array;
  private readonly attribute: BufferAttribute;
  private readonly impactPoint = new Vector3();
  private impactAt = -Infinity;
  private impactStrength = 0;
  private resting = true;

  constructor(readonly end: 1 | -1) {
    const { goalWidth: w, goalHeight: h } = PITCH;
    const white = flatMaterial('#ffffff', { roughness: 0.35 });
    const grey = flatMaterial('#9aa3ad', { roughness: 0.6 });
    const corners = {
      postL: new Vector3(-w / 2, 0, 0),
      postR: new Vector3(w / 2, 0, 0),
      barL: new Vector3(-w / 2, h, 0),
      barR: new Vector3(w / 2, h, 0),
      backTopL: new Vector3(-w / 2, h, DEPTH_TOP),
      backTopR: new Vector3(w / 2, h, DEPTH_TOP),
      backL: new Vector3(-w / 2, 0, DEPTH_GROUND),
      backR: new Vector3(w / 2, 0, DEPTH_GROUND),
    };
    this.group.add(
      bar(corners.postL, corners.barL.clone().setY(h + POST_RADIUS), POST_RADIUS, white),
      bar(corners.postR, corners.barR.clone().setY(h + POST_RADIUS), POST_RADIUS, white),
      bar(corners.barL.clone().setX(-w / 2 - POST_RADIUS), corners.barR.clone().setX(w / 2 + POST_RADIUS), POST_RADIUS, white),
      bar(corners.barL, corners.backTopL, 0.03, grey),
      bar(corners.barR, corners.backTopR, 0.03, grey),
      bar(corners.backTopL, corners.backL, 0.03, grey),
      bar(corners.backTopR, corners.backR, 0.03, grey),
      bar(corners.postL, corners.backL, 0.03, grey),
      bar(corners.postR, corners.backR, 0.03, grey),
      bar(corners.backL, corners.backR, 0.03, grey),
    );

    const indices: number[] = [];
    // Back: from the ground at full depth up to the back of the roof.
    this.panel(indices, Math.round(w / MESH), Math.round(h / MESH), (u, v) => ({
      base: new Vector3(-w / 2 + u * w, v * h, DEPTH_GROUND - (DEPTH_GROUND - DEPTH_TOP) * v + Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.08),
      normal: new Vector3(0, 0.25, 1).normalize(),
    }));
    // Roof: from the crossbar back.
    this.panel(indices, Math.round(w / MESH), Math.round(DEPTH_TOP / MESH), (u, v) => ({
      base: new Vector3(-w / 2 + u * w, h - Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.07, v * DEPTH_TOP),
      normal: new Vector3(0, 1, 0.3).normalize(),
    }));
    // Sides.
    for (const side of [-1, 1]) {
      this.panel(indices, Math.round(DEPTH_GROUND / MESH), Math.round(h / MESH), (u, v) => {
        const depth = DEPTH_GROUND - (DEPTH_GROUND - DEPTH_TOP) * v;
        return {
          base: new Vector3(side * (w / 2 + Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.05), v * h, u * depth),
          normal: new Vector3(side, 0, 0),
        };
      });
    }

    this.positions = new Float32Array(this.vertices.length * 3);
    this.vertices.forEach((v, i) => v.base.toArray(this.positions, i * 3));
    this.attribute = new BufferAttribute(this.positions, 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.attribute);
    geometry.setIndex(indices);
    const net = new LineSegments(geometry, new LineBasicMaterial({ color: '#f4f6f8', transparent: true, opacity: 0.72 }));
    net.frustumCulled = false;
    this.group.add(net);

    this.group.position.z = (end * PITCH.length) / 2;
    if (end < 0) this.group.rotation.y = Math.PI;
  }

  /** The ball hit the net at `world`: make it bulge. */
  impact(world: Vector3, now: number, strength = 1): void {
    this.group.updateWorldMatrix(true, false);
    this.impactPoint.copy(world);
    this.group.worldToLocal(this.impactPoint);
    this.impactAt = now;
    this.impactStrength = strength;
    this.resting = false;
  }

  update(now: number): void {
    if (this.resting) return;
    const t = (now - this.impactAt) / 1000;
    if (t > 2.2) {
      this.vertices.forEach((v, i) => v.base.toArray(this.positions, i * 3));
      this.attribute.needsUpdate = true;
      this.resting = true;
      return;
    }
    // A punch outwards that wobbles and settles.
    const envelope = this.impactStrength * 0.55 * Math.exp(-t * 3.2) * Math.cos(t * 13);
    this.vertices.forEach((v, i) => {
      const falloff = Math.exp(-v.base.distanceToSquared(this.impactPoint) / 0.7);
      const k = envelope * falloff;
      this.positions[i * 3] = v.base.x + v.normal.x * k;
      this.positions[i * 3 + 1] = v.base.y + v.normal.y * k;
      this.positions[i * 3 + 2] = v.base.z + v.normal.z * k;
    });
    this.attribute.needsUpdate = true;
  }

  /** Adds a grid of cords; `at(u, v)` gives each knot for u, v in 0…1. */
  private panel(indices: number[], nu: number, nv: number, at: (u: number, v: number) => NetVertex): void {
    const start = this.vertices.length;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) this.vertices.push(at(i / nu, j / nv));
    }
    const index = (i: number, j: number) => start + j * (nu + 1) + i;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        if (i < nu) indices.push(index(i, j), index(i + 1, j));
        if (j < nv) indices.push(index(i, j), index(i, j + 1));
      }
    }
  }
}
