import { ACESFilmicToneMapping, PCFSoftShadowMap, Scene, WebGLRenderer } from 'three';
import type { ActionReport, MatchEvent, MatchView } from '../../shared/model/match';
import type { Sfx } from '../audio/Sfx';
import { CameraRig } from './CameraRig';
import { MatchDirector } from './MatchDirector';
import { Stadium } from './stadium/Stadium';

/** Owns the WebGL renderer (shadows, tone mapping) and the render loop. The rest of the app talks to it through a small facade. */
export class PitchScene {
  readonly element: HTMLDivElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig = new CameraRig();
  private readonly director: MatchDirector;
  private readonly stadium: Stadium;
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private lastTime = performance.now();

  constructor(sfx: Sfx) {
    this.element = document.createElement('div');
    this.element.className = 'stage';
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.element.appendChild(this.renderer.domElement);

    // Phones get a smaller shadow map; the look is the same, just softer.
    const small = Math.min(window.screen.width, window.screen.height) < 600;
    this.stadium = new Stadium(this.scene, { shadowMapSize: small ? 1024 : 2048 });
    this.director = new MatchDirector(this.scene, this.rig, sfx, this.stadium);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.element);
    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  sync(view: MatchView): void {
    this.director.sync(view, performance.now());
  }

  beginAction(report: ActionReport): void {
    this.director.beginAction(report);
  }

  playEvent(event: MatchEvent, index: number, report: ActionReport): void {
    this.director.play(event, index, report);
  }

  endAction(): void {
    this.director.endAction();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.element;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.rig.resize(width, height);
  }

  private loop(time: number): void {
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    this.director.update(dt, time);
    this.stadium.update(dt, time);
    this.renderer.render(this.scene, this.rig.camera);
    this.frame = requestAnimationFrame(this.loop);
  }
}
