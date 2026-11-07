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

function texture(el: HTMLCanvasElement, srgb = true): CanvasTexture {
  const tex = new CanvasTexture(el);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Deterministic noise so the pitch looks the same every match (and in screenshots). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PITCH_MARGIN = 2.5;

const BLADE_COLORS = ['#2f7d34', '#3d9443', '#4aa34d', '#286b2d', '#57ad4f', '#3a8a3a'];

/**
 * A freshly cut pitch: mowing stripes with a lighter cross-cut, patchy colour, thousands of
 * blade strokes, worn goalmouths and crisp white lines. Drawn once onto a canvas.
 */
export function createPitchTexture(): CanvasTexture {
  const rand = seeded(442);
  const ppm = 28; // pixels per metre
  const w = Math.round((PITCH.width + PITCH_MARGIN * 2) * ppm);
  const l = Math.round((PITCH.length + PITCH_MARGIN * 2) * ppm);
  const [el, ctx] = canvas(w, l);
  const m = (metres: number) => metres * ppm;

  ctx.fillStyle = '#3b8d3e';
  ctx.fillRect(0, 0, w, l);

  // Mowing: bands across the pitch, plus a fainter cross-cut for a chequered sheen.
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,220,0.07)' : 'rgba(0,30,0,0.06)';
    ctx.fillRect(0, (i * l) / stripes, w, l / stripes + 1);
  }
  const cross = 8;
  for (let j = 0; j < cross; j++) {
    if (j % 2 === 0) continue;
    ctx.fillStyle = 'rgba(255,255,230,0.028)';
    ctx.fillRect((j * w) / cross, 0, w / cross + 1, l);
  }

  // Patchy colour: soft blobs of darker and yellower grass.
  for (let i = 0; i < 260; i++) {
    const x = rand() * w;
    const y = rand() * l;
    const r = m(1.5 + rand() * 5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() < 0.5 ? 'rgba(18,60,20,0.09)' : 'rgba(170,190,70,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Blades.
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 46000; i++) {
    const x = rand() * w;
    const y = rand() * l;
    const len = 1.5 + rand() * 3;
    const a = -Math.PI / 2 + (rand() - 0.5) * 0.9;
    ctx.strokeStyle = BLADE_COLORS[Math.floor(rand() * BLADE_COLORS.length)]!;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const left = m(PITCH_MARGIN);
  const top = m(PITCH_MARGIN);
  const pw = m(PITCH.width);
  const pl = m(PITCH.length);
  const cx = left + pw / 2;

  // Wear: the goalmouths and the centre spot take a beating.
  const wear = (x: number, y: number, rx: number, ry: number, alpha: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(150,128,72,${alpha})`);
    g.addColorStop(1, 'rgba(150,128,72,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  };
  wear(cx, top + m(1.2), m(3.2), m(1.8), 0.32);
  wear(cx, top + pl - m(1.2), m(3.2), m(1.8), 0.32);
  wear(cx, top + pl / 2, m(1.6), m(1.6), 0.16);

  // Lines: a soft halo under a crisp stroke.
  const lines = (style: string, width: number) => {
    ctx.strokeStyle = style;
    ctx.fillStyle = style;
    ctx.lineWidth = width;
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
      const box = (bw: number, depth: number) =>
        ctx.strokeRect(cx - m(bw) / 2, end === 0 ? lineY : lineY - m(depth), m(bw), m(depth));
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
    // Corner arcs.
    for (const [x, y, a0] of [[left, top, 0], [left + pw, top, Math.PI / 2], [left + pw, top + pl, Math.PI], [left, top + pl, Math.PI * 1.5]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, m(0.8), a0, a0 + Math.PI / 2);
      ctx.stroke();
    }
  };
  lines('rgba(255,255,255,0.14)', m(0.26));
  lines('rgba(250,252,245,0.94)', m(0.12));
  return texture(el);
}

/** Tiny tiling height noise that makes the low sun catch the grass. */
export function createGrassBumpTexture(): CanvasTexture {
  const rand = seeded(7);
  const size = 256;
  const [el, ctx] = canvas(size, size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const v = Math.floor(rand() * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 1.5, 2 + rand() * 3);
  }
  const tex = texture(el, false);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
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

/** Soft white glow for floodlight lamps. */
export function createGlowTexture(): CanvasTexture {
  const [el, ctx] = canvas(128, 128);
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,250,230,1)');
  gradient.addColorStop(0.25, 'rgba(255,240,200,0.55)');
  gradient.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return texture(el);
}

/** The number printed on the back of a shirt. */
export function createShirtNumberTexture(number: number, color: string): CanvasTexture {
  const [el, ctx] = canvas(128, 128);
  ctx.font = '900 92px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeText(String(number), 64, 70);
  ctx.fillStyle = color;
  ctx.fillText(String(number), 64, 70);
  return texture(el);
}

const AD_SLOGANS: [string, string, string][] = [
  ['4-4-2', '#0b3d62', '#b6f34a'],
  ['PLAY FAIR', '#c8102e', '#ffffff'],
  ['TURN-BASED FOOTBALL', '#111827', '#f5b942'],
  ['RESPECT', '#1d4ed8', '#ffffff'],
  ['SIX-A-SIDE', '#16a34a', '#ffffff'],
  ['TACTICS WIN', '#f2c230', '#111827'],
];

/** Pitch-side advertising boards (fictional slogans only). */
export function createAdBoardTexture(): CanvasTexture {
  const [el, ctx] = canvas(2048, 64);
  const segment = el.width / AD_SLOGANS.length;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 34px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
  AD_SLOGANS.forEach(([text, background, foreground], i) => {
    ctx.fillStyle = background;
    ctx.fillRect(i * segment, 0, segment, 64);
    ctx.fillStyle = foreground;
    ctx.fillText(text, i * segment + segment / 2, 34);
  });
  const tex = texture(el);
  tex.wrapS = RepeatWrapping;
  return tex;
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
