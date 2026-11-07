const MUTE_KEY = '442.muted';

/** Synthesised sound effects (no audio files): whistle, kick, crowd roar, card flip. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private mutedFlag: boolean;

  constructor() {
    this.mutedFlag = (() => {
      try {
        return localStorage.getItem(MUTE_KEY) === '1';
      } catch {
        return false;
      }
    })();
    // Browsers only allow audio after a user gesture.
    const unlock = () => {
      this.context()?.resume().catch(() => undefined);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  toggleMute(): boolean {
    this.mutedFlag = !this.mutedFlag;
    try {
      localStorage.setItem(MUTE_KEY, this.mutedFlag ? '1' : '0');
    } catch {
      // ignore
    }
    return this.mutedFlag;
  }

  whistle(blasts = 1): void {
    const ctx = this.ready();
    if (!ctx) return;
    for (let i = 0; i < blasts; i++) {
      const start = ctx.currentTime + i * 0.32;
      const length = blasts === 3 && i === 2 ? 0.7 : 0.22;
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();
      osc.frequency.value = 2900;
      lfo.frequency.value = 38;
      lfoGain.gain.value = 140;
      lfo.connect(lfoGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
      gain.gain.setValueAtTime(0.08, start + length - 0.04);
      gain.gain.linearRampToValueAtTime(0, start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      lfo.start(start);
      osc.stop(start + length);
      lfo.stop(start + length);
    }
  }

  kick(strength = 1): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
    gain.gain.setValueAtTime(0.25 * strength, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  roar(durationS = 2.6, intensity = 1): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise(ctx, durationS);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22 * intensity, now + 0.35);
    gain.gain.linearRampToValueAtTime(0.12 * intensity, now + durationS * 0.6);
    gain.gain.linearRampToValueAtTime(0, now + durationS);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now);
  }

  card(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.09);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  private ready(): AudioContext | null {
    if (this.mutedFlag) return null;
    const ctx = this.context();
    return ctx && ctx.state === 'running' ? ctx : null;
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  private noise(ctx: AudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = 0.97 * last + 0.03 * (Math.random() * 2 - 1);
      data[i] = last * 6;
    }
    return buffer;
  }
}
