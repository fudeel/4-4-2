import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import type { Side } from '../../../shared/model/match';
import { flatMaterial, lowPolyMaterial, merge, paint } from '../lowpoly';
import { PITCH } from '../PitchSpace';
import { PITCH_MARGIN, createAdBoardTexture, createGlowTexture, createGrassBumpTexture, createPitchTexture } from '../textures';
import { Crowd, type SeatRow } from './Crowd';
import { Goal } from './Goal';

/** What the match choreography can ask of the stadium. */
export interface StadiumEffects {
  /** The ball hit the net at this world point. */
  netImpact(point: Vector3, now: number): void;
  /** Fans of `side` (or everyone, for `null`) get excited. */
  cheer(side: Side | null, strength: number): void;
  setTeamColors(home: string, away: string): void;
}

export interface StadiumOptions {
  /** Resolution of the sun's shadow map (lower on phones). */
  shadowMapSize: number;
}

/** Golden hour: the sun low behind the near-left corner, so long shadows run up the pitch. */
const SUN_DIRECTION = new Vector3(-0.62, 0.62, -0.48).normalize();
const SKY = { top: '#3a6fb8', horizon: '#f7c58f', ground: '#46523f', sun: '#ffd7a0' };
const HALF_W = PITCH.width / 2;
const HALF_L = PITCH.length / 2;

/**
 * Builds the static world — sky, light, pitch, goals, stands, crowd, floodlights, boards —
 * in a stylised low-poly look, and animates the few things that move (nets, fans, flags).
 */
export class Stadium implements StadiumEffects {
  private readonly goals: Goal[] = [];
  private readonly crowd: Crowd;
  private readonly flags: Group[] = [];
  private teamColors = '';

  constructor(scene: Scene, options: StadiumOptions) {
    scene.background = new Color(SKY.horizon);
    scene.fog = new Fog('#c9b896', 95, 260);
    this.sky(scene);
    this.lights(scene, options.shadowMapSize);
    this.ground(scene);
    for (const end of [-1, 1] as const) {
      const goal = new Goal(end);
      this.goals.push(goal);
      scene.add(goal.group);
    }
    const rows = this.stands(scene);
    this.crowd = new Crowd(scene, rows);
    this.boards(scene);
    this.floodlights(scene);
    this.cornerFlags(scene);
    this.dugouts(scene);
    this.trees(scene);
  }

  netImpact(point: Vector3, now: number): void {
    const goal = point.z >= 0 ? this.goals.find(g => g.end === 1) : this.goals.find(g => g.end === -1);
    goal?.impact(point, now);
  }

  cheer(side: Side | null, strength: number): void {
    this.crowd.cheer(side, strength);
  }

  setTeamColors(home: string, away: string): void {
    const key = `${home}/${away}`;
    if (key === this.teamColors) return;
    this.teamColors = key;
    this.crowd.setTeamColors(home, away);
  }

  update(dt: number, now: number): void {
    for (const goal of this.goals) goal.update(now);
    this.crowd.update(dt, now);
    const t = now / 1000;
    this.flags.forEach((flag, i) => {
      flag.rotation.y = Math.sin(t * 2.3 + i * 1.7) * 0.35 + 0.4;
    });
  }

  // ── Sky & light ────────────────────────────────────────────────────────────

  private sky(scene: Scene): void {
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new Color(SKY.top) },
        horizon: { value: new Color(SKY.horizon) },
        ground: { value: new Color(SKY.ground) },
        sunColor: { value: new Color(SKY.sun) },
        sunDirection: { value: SUN_DIRECTION },
      },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 ground;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        varying vec3 vDirection;
        void main() {
          float h = vDirection.y;
          vec3 color = h > 0.0
            ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.75))
            : mix(horizon, ground, smoothstep(0.0, 0.12, -h));
          float sun = max(dot(vDirection, sunDirection), 0.0);
          color += sunColor * (pow(sun, 400.0) * 2.5 + pow(sun, 8.0) * 0.35);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    scene.add(new Mesh(new SphereGeometry(320, 32, 16), material));
  }

  private lights(scene: Scene, shadowMapSize: number): void {
    scene.add(new HemisphereLight('#cfe2ff', '#4f6b3a', 0.9));

    const sun = new DirectionalLight('#ffdcae', 2.7);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -38;
    cam.right = 38;
    cam.top = 38;
    cam.bottom = -38;
    cam.near = 10;
    cam.far = 130;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    scene.add(sun, sun.target);

    // Cool bounce light from the opposite side, so shadowed faces aren't black.
    const fill = new DirectionalLight('#a8c6ff', 0.5);
    fill.position.set(30, 20, 34);
    scene.add(fill);
  }

  // ── Ground ─────────────────────────────────────────────────────────────────

  private ground(scene: Scene): void {
    const bump = createGrassBumpTexture();
    const surroundBump = bump.clone();
    surroundBump.repeat.set(70, 80);
    const surround = new Mesh(
      new PlaneGeometry(140, 160),
      new MeshStandardMaterial({ color: '#2f6e32', roughness: 1, bumpMap: surroundBump, bumpScale: 0.6 }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.02;
    surround.receiveShadow = true;
    scene.add(surround);

    const pitchBump = bump.clone();
    const width = PITCH.width + PITCH_MARGIN * 2;
    const length = PITCH.length + PITCH_MARGIN * 2;
    pitchBump.repeat.set(width / 1.6, length / 1.6);
    const pitch = new Mesh(
      new PlaneGeometry(width, length),
      new MeshStandardMaterial({ map: createPitchTexture(), roughness: 0.95, bumpMap: pitchBump, bumpScale: 0.8 }),
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    scene.add(pitch);
  }

  // ── Stands ─────────────────────────────────────────────────────────────────

  /** Tiered concrete stands with seats on every step and roofs over the long sides. Returns the seat rows. */
  private stands(scene: Scene): SeatRow[] {
    const rows: SeatRow[] = [];
    const stand = (options: { length: number; rows: number; distance: number; rotation: number; team: Side | null; roof: boolean }) => {
      const parts: BufferGeometry[] = [];
      const step = { depth: 0.9, rise: 0.5, base: 0.7 };
      for (let r = 0; r < options.rows; r++) {
        const height = step.base + (r + 1) * step.rise;
        parts.push(paint(new BoxGeometry(options.length, height, step.depth).translate(0, height / 2, -(r * step.depth + step.depth / 2)), r % 2 ? '#56606c' : '#4b5560'));
        // A strip of seat backs along each step.
        parts.push(paint(new BoxGeometry(options.length, 0.12, 0.18).translate(0, height + 0.06, -(r * step.depth + step.depth - 0.12)), '#2f3a48'));
      }
      const depth = options.rows * step.depth;
      const wallHeight = step.base + options.rows * step.rise + (options.roof ? 4.8 : 1.4);
      parts.push(paint(new BoxGeometry(options.length + 0.6, wallHeight, 0.5).translate(0, wallHeight / 2, -depth - 0.25), '#3b4450'));
      if (options.roof) {
        // Roof slab, tilted down towards the pitch, on slim columns.
        const roof = new BoxGeometry(options.length + 1.2, 0.35, depth + 2.4);
        roof.rotateX(-0.12).translate(0, wallHeight + 0.2, -depth / 2 + 0.6);
        parts.push(paint(roof, '#e8ecef'));
        for (let x = -options.length / 2 + 2; x <= options.length / 2 - 2; x += 10) {
          parts.push(paint(new CylinderGeometry(0.14, 0.14, wallHeight, 6).translate(x, wallHeight / 2, -0.2), '#cfd5db'));
        }
      }
      const mesh = new Mesh(merge(parts), lowPolyMaterial());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const group = new Group();
      group.add(mesh);
      group.rotation.y = options.rotation;
      // Front edge of the stand at `distance` from the centre, facing the pitch.
      const forward = new Vector3(Math.sin(options.rotation), 0, Math.cos(options.rotation));
      group.position.copy(forward).multiplyScalar(-options.distance);
      scene.add(group);
      group.updateMatrixWorld();

      for (let r = 0; r < options.rows; r++) {
        const y = step.base + (r + 1) * step.rise;
        const z = -(r * step.depth + step.depth * 0.45);
        const from = new Vector3(-options.length / 2 + 0.6, y, z).applyMatrix4(group.matrixWorld);
        const to = new Vector3(options.length / 2 - 0.6, y, z).applyMatrix4(group.matrixWorld);
        rows.push({ from, to, facing: options.rotation, team: options.team });
      }
    };
    // Home fans along the left touchline, away fans on the right, a mix behind the goals.
    stand({ length: PITCH.length + 10, rows: 10, distance: HALF_W + 5, rotation: Math.PI / 2, team: 'home', roof: true });
    stand({ length: PITCH.length + 10, rows: 10, distance: HALF_W + 5, rotation: -Math.PI / 2, team: 'away', roof: true });
    stand({ length: PITCH.width + 8, rows: 7, distance: HALF_L + 5.5, rotation: Math.PI, team: null, roof: false });
    stand({ length: PITCH.width + 8, rows: 7, distance: HALF_L + 5.5, rotation: 0, team: null, roof: false });
    return rows;
  }

  // ── Props ──────────────────────────────────────────────────────────────────

  private boards(scene: Scene): void {
    const make = (length: number, position: Vector3, rotationY: number) => {
      const map = createAdBoardTexture();
      map.repeat.set(length / 26, 1);
      const material = new MeshStandardMaterial({ map, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.35, roughness: 0.6 });
      const board = new Mesh(new BoxGeometry(length, 0.85, 0.12), material);
      board.position.copy(position).setY(0.43);
      board.rotation.y = rotationY;
      board.castShadow = true;
      board.receiveShadow = true;
      scene.add(board);
    };
    make(PITCH.length + 4, new Vector3(-(HALF_W + 3), 0, 0), Math.PI / 2);
    make(PITCH.length + 4, new Vector3(HALF_W + 3, 0, 0), -Math.PI / 2);
    for (const end of [-1, 1]) {
      for (const x of [-1, 1]) make(11, new Vector3(x * 9.5, 0, end * (HALF_L + 3.4)), end > 0 ? Math.PI : 0);
    }
  }

  private floodlights(scene: Scene): void {
    const glow = new SpriteMaterial({ map: createGlowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    const lamp = new MeshBasicMaterial({ color: '#fff6dc', fog: false });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const group = new Group();
        const mast = new Mesh(merge([
          paint(new CylinderGeometry(0.28, 0.55, 28, 6).translate(0, 14, 0), '#7d8792'),
          paint(new BoxGeometry(4.6, 2.6, 0.5).translate(0, 28.6, 0), '#2a3038'),
        ]), lowPolyMaterial());
        mast.castShadow = true;
        group.add(mast);
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 2; j++) {
            const bulb = new Mesh(new PlaneGeometry(1.1, 0.9), lamp);
            bulb.position.set(-1.4 + i * 1.4, 28.0 + j * 1.2, 0.26);
            group.add(bulb);
          }
        }
        const halo = new Sprite(glow);
        halo.scale.setScalar(11);
        halo.position.set(0, 28.6, 1.2);
        group.add(halo);
        group.position.set(sx * (HALF_W + 15), 0, sz * (HALF_L + 12));
        group.lookAt(0, 0, 0);
        scene.add(group);
      }
    }
  }

  private cornerFlags(scene: Scene): void {
    const pole = flatMaterial('#f5f5f0');
    const cloth = new MeshStandardMaterial({ color: '#ffcc1f', side: DoubleSide, flatShading: true, roughness: 0.8 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const stick = new Mesh(new CylinderGeometry(0.035, 0.035, 1.6, 5), pole);
        stick.position.set(sx * HALF_W, 0.8, sz * HALF_L);
        stick.castShadow = true;
        const flag = new Group();
        const triangle = new Mesh(new PlaneGeometry(0.5, 0.34), cloth);
        triangle.position.x = 0.25;
        triangle.castShadow = true;
        flag.add(triangle);
        flag.position.set(sx * HALF_W, 1.42, sz * HALF_L);
        this.flags.push(flag);
        scene.add(stick, flag);
      }
    }
  }

  private dugouts(scene: Scene): void {
    for (const z of [-6, 6]) {
      const shelter = new Mesh(merge([
        paint(new BoxGeometry(0.15, 2, 5).translate(-1.1, 1, 0), '#1f2a37'),
        paint(new BoxGeometry(1.5, 0.12, 5.2).translate(-0.4, 2.05, 0), '#dfe5ea'),
        paint(new BoxGeometry(1.5, 2, 0.12).translate(-0.4, 1, -2.55), '#1f2a37'),
        paint(new BoxGeometry(1.5, 2, 0.12).translate(-0.4, 1, 2.55), '#1f2a37'),
        paint(new BoxGeometry(0.5, 0.45, 4.6).translate(-0.7, 0.23, 0), '#c8102e'),
      ]), lowPolyMaterial());
      shelter.castShadow = true;
      shelter.receiveShadow = true;
      shelter.position.set(-(HALF_W + 1.9), 0, z);
      scene.add(shelter);
    }
  }

  /** Low-poly trees beyond the open corners of the ground. */
  private trees(scene: Scene): void {
    const spots: Vector3[] = [];
    let s = 99;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let i = 0; i < 9; i++) {
          spots.push(new Vector3(sx * (HALF_W + 12 + rand() * 22), 0, sz * (HALF_L + 10 + rand() * 18)));
        }
      }
    }
    const crowns = new InstancedMesh(new ConeGeometry(2.2, 6, 6).translate(0, 5.5, 0), flatMaterial('#ffffff'), spots.length);
    const trunks = new InstancedMesh(new CylinderGeometry(0.25, 0.35, 2.6, 5).translate(0, 1.3, 0), flatMaterial('#5b3d27'), spots.length);
    const matrix = new Matrix4();
    spots.forEach((spot, i) => {
      const size = 0.8 + rand() * 0.6;
      matrix.makeScale(size, size, size).setPosition(spot);
      crowns.setMatrixAt(i, matrix);
      trunks.setMatrixAt(i, matrix);
      crowns.setColorAt(i, new Color('#2c5e2e').offsetHSL(rand() * 0.04 - 0.02, 0, rand() * 0.1 - 0.05));
    });
    crowns.castShadow = true;
    scene.add(crowns, trunks);
  }
}
