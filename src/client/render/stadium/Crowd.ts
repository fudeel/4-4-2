import {
  BoxGeometry,
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import type { Side } from '../../../shared/model/match';

/** Where fans sit: a row of seats along a straight line, all facing the same way. */
export interface SeatRow {
  from: Vector3;
  to: Vector3;
  /** Rotation around Y so the fans face the pitch. */
  facing: number;
  /** Who sits here: a team's fans, or a neutral mix. */
  team: Side | null;
}

const SEAT_SPACING = 0.78;
const EMPTY_SEATS = 0.12;
const NEUTRAL_SHIRTS = ['#e5e7eb', '#9aa5b1', '#2b3440', '#f2c230', '#1f2937', '#cbd5e1', '#7c3aed', '#0ea5e9'];
const SKIN = ['#f1c7a5', '#d9a47c', '#b07a52', '#8a5a3b', '#5e3b26', '#e6b993'];
const TEAM_INDEX: Record<Side, number> = { home: 1, away: 2 };

/**
 * The crowd: two instanced meshes (bodies and heads) with per-fan phase and team.
 * All motion is in the vertex shader — a gentle sway, and jumping when their team celebrates —
 * so thousands of fans cost two draw calls and no per-frame CPU work.
 */
export class Crowd {
  private readonly uniforms = {
    uTime: { value: 0 },
    /** Excitement of neutral, home and away fans (0 … 1). */
    uCheer: { value: new Vector3() },
  };
  private readonly bodies: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly teams: (Side | null)[] = [];
  private readonly rand: () => number;

  constructor(scene: Scene, rows: SeatRow[], seed = 4242) {
    let s = seed;
    this.rand = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const seats: { position: Vector3; facing: number; team: Side | null }[] = [];
    for (const row of rows) {
      const length = row.from.distanceTo(row.to);
      const count = Math.floor(length / SEAT_SPACING);
      for (let i = 0; i <= count; i++) {
        if (this.rand() < EMPTY_SEATS) continue;
        const position = row.from.clone().lerp(row.to, i / count);
        position.x += (this.rand() - 0.5) * 0.12;
        // In a team's end, a few neutrals; in neutral areas, a few of each.
        const team = row.team && this.rand() < 0.88 ? row.team : this.rand() < 0.5 ? null : this.rand() < 0.5 ? 'home' : 'away';
        seats.push({ position, facing: row.facing + (this.rand() - 0.5) * 0.3, team });
      }
    }

    this.bodies = this.instanced(new BoxGeometry(0.44, 0.58, 0.3).translate(0, 0.3, 0), seats.length);
    this.heads = this.instanced(new IcosahedronGeometry(0.14, 0).translate(0, 0.74, 0), seats.length);
    const phase = new Float32Array(seats.length);
    const team = new Float32Array(seats.length);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const skin = new Color();
    seats.forEach((seat, i) => {
      const size = 0.9 + this.rand() * 0.25;
      matrix.compose(seat.position, rotation.setFromAxisAngle(up, seat.facing), scale.setScalar(size));
      this.bodies.setMatrixAt(i, matrix);
      this.heads.setMatrixAt(i, matrix);
      this.heads.setColorAt(i, skin.set(SKIN[Math.floor(this.rand() * SKIN.length)]!));
      phase[i] = this.rand() * Math.PI * 2;
      team[i] = seat.team ? TEAM_INDEX[seat.team] : 0;
      this.teams.push(seat.team);
    });
    for (const mesh of [this.bodies, this.heads]) {
      mesh.geometry.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
      mesh.geometry.setAttribute('aTeam', new InstancedBufferAttribute(team, 1));
      scene.add(mesh);
    }
    this.setTeamColors('#c8102e', '#1d4ed8');
  }

  /** Dresses each team's fans in its colours (with some variety); neutrals keep a mixed palette. */
  setTeamColors(home: string, away: string): void {
    const colors: Record<Side, Color> = { home: new Color(home), away: new Color(away) };
    const color = new Color();
    this.teams.forEach((team, i) => {
      if (team) {
        color.copy(colors[team]);
        const roll = this.rand();
        if (roll < 0.18) color.set('#f4f4f4');
        else color.offsetHSL(0, 0, (this.rand() - 0.5) * 0.12);
      } else {
        color.set(NEUTRAL_SHIRTS[Math.floor(this.rand() * NEUTRAL_SHIRTS.length)]!);
      }
      this.bodies.setColorAt(i, color);
    });
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
  }

  /** Gets a section of the crowd on its feet; `null` excites everybody a little. */
  cheer(side: Side | null, strength: number): void {
    const cheer = this.uniforms.uCheer.value;
    if (side === null) cheer.set(Math.max(cheer.x, strength), Math.max(cheer.y, strength * 0.6), Math.max(cheer.z, strength * 0.6));
    else if (side === 'home') cheer.y = Math.max(cheer.y, strength);
    else cheer.z = Math.max(cheer.z, strength);
  }

  update(dt: number, now: number): void {
    this.uniforms.uTime.value = now / 1000;
    this.uniforms.uCheer.value.multiplyScalar(Math.exp(-dt * 0.45));
  }

  private instanced(geometry: BufferGeometry, count: number): InstancedMesh {
    const material = new MeshLambertMaterial({ flatShading: true });
    material.onBeforeCompile = shader => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uCheer = this.uniforms.uCheer;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aPhase;
          attribute float aTeam;
          uniform float uTime;
          uniform vec3 uCheer;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float cheer = aTeam < 0.5 ? uCheer.x : (aTeam < 1.5 ? uCheer.y : uCheer.z);
          float bounce = abs(sin(uTime * 8.5 + aPhase));
          transformed.y += sin(uTime * 1.7 + aPhase) * 0.03 + cheer * bounce * 0.75;
          transformed.x += sin(uTime * 1.1 + aPhase * 2.0) * 0.02;`,
        );
    };
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    return mesh;
  }
}
