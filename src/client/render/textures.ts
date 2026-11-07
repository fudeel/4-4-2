import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { PITCH } from './PitchSpace';

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  return [el, ctx];
}

function texture(el: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(el);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export const PITCH_MARGIN = 2.5;

/** Mown stripes and white markings, drawn once onto a canvas. */
export function createPitchTexture(): CanvasTexture {
  const ppm = 20; // pixels per metre
  const w = (PITCH.width + PITCH_MARGIN * 2) * ppm;
  const l = (PITCH.length + PITCH_MARGIN * 2) * ppm;
  const [el, ctx] = canvas(w, l);
  const stripes = 12;
  const stripe = l / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#2f8a3c' : '#2a7d36';
    ctx.fillRect(0, i * stripe, w, stripe + 1);
  }
  // Subtle grass noise.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.035)';
    ctx.fillRect(Math.random() * w, Math.random() * l, 2, 2);
  }

  const m = (metres: number) => metres * ppm;
  const left = m(PITCH_MARGIN);
  const top = m(PITCH_MARGIN);
  const pw = m(PITCH.width);
  const pl = m(PITCH.length);
  const cx = left + pw / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = m(0.12);
  ctx.strokeRect(left, top, pw, pl);
  ctx.beginPath();
  ctx.moveTo(left, top + pl / 2);
  ctx.lineTo(left + pw, top + pl / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, top + pl / 2, m(4), 0, Math.PI * 2);
  ctx.stroke();

  for (const end of [0, 1]) {
    const lineY = end === 0 ? top : top + pl;
    const sign = end === 0 ? 1 : -1;
    const box = (width: number, depth: number) =>
      ctx.strokeRect(cx - m(width) / 2, end === 0 ? lineY : lineY - m(depth), m(width), m(depth));
    box(PITCH.boxWidth, PITCH.boxDepth);
    box(8, 3);
    const spotY = lineY + sign * m(PITCH.penaltySpot);
    ctx.beginPath();
    ctx.arc(cx, spotY, m(0.2), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, spotY, m(4), sign > 0 ? Math.PI * 0.2 : Math.PI * 1.2, sign > 0 ? Math.PI * 0.8 : Math.PI * 1.8);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, top + pl / 2, m(0.2), 0, Math.PI * 2);
  ctx.fill();
  return texture(el);
}

export function createNetTexture(): CanvasTexture {
  const [el, ctx] = canvas(128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }
  const tex = texture(el);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}

export function createCrowdTexture(): CanvasTexture {
  const [el, ctx] = canvas(1024, 128);
  ctx.fillStyle = '#121a24';
  ctx.fillRect(0, 0, 1024, 128);
  const palette = ['#c8102e', '#1d4ed8', '#f4f4f4', '#f2c230', '#9aa5b1', '#2b3440', '#e0f2fe'];
  for (let row = 0; row < 8; row++) {
    for (let x = 0; x < 1024; x += 6) {
      if (Math.random() < 0.18) continue;
      ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)]!;
      ctx.fillRect(x + Math.random() * 2, row * 16 + 4 + Math.random() * 3, 4, 7);
    }
  }
  const tex = texture(el);
  tex.wrapS = RepeatWrapping;
  return tex;
}

export function createShadowTexture(): CanvasTexture {
  const [el, ctx] = canvas(64, 64);
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return texture(el);
}

export function createBallTexture(): CanvasTexture {
  const [el, ctx] = canvas(256, 128);
  ctx.fillStyle = '#f7f7f7';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#1b1b1b';
  for (let i = 0; i < 12; i++) {
    const x = (i % 6) * 44 + (i >= 6 ? 22 : 0) + 10;
    const y = i >= 6 ? 88 : 36;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11);
    }
    ctx.closePath();
    ctx.fill();
  }
  return texture(el);
}

/** A rounded badge with text, used for shirt numbers and name tags above players. */
export function createLabelTexture(text: string, background: string, foreground = '#ffffff', minWidth = 64): { texture: CanvasTexture; aspect: number } {
  const height = 64;
  const font = 'bold 40px system-ui, sans-serif';
  const [el, ctx] = canvas(8, height);
  ctx.font = font;
  const width = Math.max(minWidth, Math.ceil(ctx.measureText(text).width) + 36);
  el.width = width; // resizing resets the context state
  ctx.fillStyle = background;
  const r = 26;
  ctx.beginPath();
  ctx.roundRect(2, 2, width - 4, height - 4, r);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.fillStyle = foreground;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 2);
  return { texture: texture(el), aspect: width / height };
}
