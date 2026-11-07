import { Color, Float32BufferAttribute, MeshStandardMaterial, type BufferGeometry, type ColorRepresentation } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-poly helpers. Parts are painted with vertex colours and merged, so a whole body segment
 * (e.g. shin + sock + boot) is one mesh, and every player shares one flat-shaded material.
 */

/** Paints a geometry in one flat colour (stored as vertex colours). Returns a non-indexed copy. */
export function paint(geometry: BufferGeometry, color: ColorRepresentation): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  const c = new Color(color);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

/** Merges painted parts into one geometry. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Could not merge low-poly parts');
  for (const part of parts) part.dispose();
  return merged;
}

let sharedVertexColorMaterial: MeshStandardMaterial | null = null;

/** The one flat-shaded, vertex-coloured material used by players and props. */
export function lowPolyMaterial(): MeshStandardMaterial {
  sharedVertexColorMaterial ??= new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 });
  return sharedVertexColorMaterial;
}

/** A flat-shaded material of a single colour. */
export function flatMaterial(color: ColorRepresentation, options: { roughness?: number; metalness?: number; emissive?: ColorRepresentation; emissiveIntensity?: number } = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: options.roughness ?? 0.85,
    metalness: options.metalness ?? 0,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 1,
  });
}
