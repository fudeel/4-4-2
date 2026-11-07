import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { PITCH } from './PitchSpace';
import { PITCH_MARGIN, createCrowdTexture, createNetTexture, createPitchTexture } from './textures';

/** Builds the static environment: pitch, goals, stands, floodlights and lighting. */
export class PitchBuilder {
  build(scene: Scene): void {
    scene.background = new Color('#0a1520');
    scene.fog = new Fog('#0a1520', 70, 150);

    scene.add(new HemisphereLight('#dbeeff', '#1d3b22', 1.15));
    const sun = new DirectionalLight('#ffffff', 1.5);
    sun.position.set(-18, 40, -10);
    scene.add(sun);

    const surround = new Mesh(new PlaneGeometry(140, 160), new MeshLambertMaterial({ color: '#1f5c2a' }));
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.02;
    scene.add(surround);

    const pitch = new Mesh(
      new PlaneGeometry(PITCH.width + PITCH_MARGIN * 2, PITCH.length + PITCH_MARGIN * 2),
      new MeshLambertMaterial({ map: createPitchTexture() }),
    );
    pitch.rotation.x = -Math.PI / 2;
    scene.add(pitch);

    for (const end of [-1, 1]) scene.add(this.goal(end));
    this.stands(scene);
    this.floodlights(scene);
  }

  private goal(end: number): Group {
    const group = new Group();
    const post = new MeshLambertMaterial({ color: '#ffffff' });
    const { goalWidth: w, goalHeight: h } = PITCH;
    const depth = 1.6;
    const postGeo = new CylinderGeometry(0.07, 0.07, h, 10);
    for (const side of [-1, 1]) {
      const p = new Mesh(postGeo, post);
      p.position.set((side * w) / 2, h / 2, 0);
      group.add(p);
    }
    const bar = new Mesh(new CylinderGeometry(0.07, 0.07, w, 10), post);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, h, 0);
    group.add(bar);

    const netMaterial = (repeatX: number, repeatY: number) => {
      const map = createNetTexture();
      map.repeat.set(repeatX, repeatY);
      return new MeshBasicMaterial({ map, transparent: true, side: DoubleSide, depthWrite: false });
    };
    const back = new Mesh(new PlaneGeometry(w, h), netMaterial(w * 2, h * 2));
    back.position.set(0, h / 2, depth);
    group.add(back);
    const top = new Mesh(new PlaneGeometry(w, depth), netMaterial(w * 2, depth * 2));
    top.rotation.x = Math.PI / 2;
    top.position.set(0, h, depth / 2);
    group.add(top);
    for (const side of [-1, 1]) {
      const wall = new Mesh(new PlaneGeometry(depth, h), netMaterial(depth * 2, h * 2));
      wall.rotation.y = Math.PI / 2;
      wall.position.set((side * w) / 2, h / 2, depth / 2);
      group.add(wall);
    }

    group.position.z = (end * PITCH.length) / 2;
    if (end < 0) group.rotation.y = Math.PI;
    return group;
  }

  private stands(scene: Scene): void {
    const crowd = createCrowdTexture();
    const make = (length: number, x: number, z: number, rotationY: number) => {
      const map = crowd.clone();
      map.needsUpdate = true;
      map.repeat.set(length / 30, 1);
      const stand = new Mesh(new BoxGeometry(length, 7, 1), [
        new MeshLambertMaterial({ color: '#141c26' }),
        new MeshLambertMaterial({ color: '#141c26' }),
        new MeshLambertMaterial({ color: '#141c26' }),
        new MeshLambertMaterial({ color: '#141c26' }),
        new MeshLambertMaterial({ map }),
        new MeshLambertMaterial({ color: '#141c26' }),
      ]);
      stand.position.set(x, 4.2, z);
      stand.rotation.set(-0.5, rotationY, 0, 'YXZ');
      scene.add(stand);
    };
    const sideX = PITCH.width / 2 + 9;
    const endZ = PITCH.length / 2 + 9;
    make(PITCH.length + 14, -sideX, 0, Math.PI / 2);
    make(PITCH.length + 14, sideX, 0, -Math.PI / 2);
    make(PITCH.width + 14, 0, endZ, Math.PI);
    make(PITCH.width + 14, 0, -endZ, 0);

    // Advertising boards.
    const board = new MeshLambertMaterial({ color: '#0f2a44', emissive: '#0b3d62', emissiveIntensity: 0.6 });
    for (const sx of [-1, 1]) {
      const b = new Mesh(new BoxGeometry(0.15, 0.8, PITCH.length + 4), board);
      b.position.set(sx * (PITCH.width / 2 + 3.2), 0.4, 0);
      scene.add(b);
    }
  }

  private floodlights(scene: Scene): void {
    const pole = new MeshLambertMaterial({ color: '#59626d' });
    const lamp = new MeshBasicMaterial({ color: '#fffbe6' });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const group = new Group();
        const p = new Mesh(new CylinderGeometry(0.25, 0.35, 26, 8), pole);
        p.position.y = 13;
        group.add(p);
        const head = new Mesh(new BoxGeometry(3.2, 1.6, 0.4), lamp);
        head.position.y = 26.5;
        group.add(head);
        group.position.set(sx * (PITCH.width / 2 + 13), 0, sz * (PITCH.length / 2 + 11));
        group.lookAt(0, 0, 0);
        scene.add(group);
      }
    }
  }
}
