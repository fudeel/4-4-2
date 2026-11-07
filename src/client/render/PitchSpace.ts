import { Vector3 } from 'three';
import type { Side } from '../../shared/model/match';

/** Small-sided pitch dimensions, in metres. */
export const PITCH = {
  length: 48,
  width: 30,
  goalWidth: 5,
  goalHeight: 2.1,
  boxDepth: 8,
  boxWidth: 16,
  penaltySpot: 6.5,
} as const;

/**
 * Converts between team space and world space.
 * Team space: nx −1 (left) … 1 (right), ny 0 (own goal line) … 1 (opponent goal line).
 * The viewer's team always attacks towards +z (away from the camera).
 */
export class PitchSpace {
  constructor(private viewer: Side) {}

  setViewer(viewer: Side): void {
    this.viewer = viewer;
  }

  direction(side: Side): 1 | -1 {
    return side === this.viewer ? 1 : -1;
  }

  toWorld(side: Side, nx: number, ny: number, y = 0, out = new Vector3()): Vector3 {
    const dir = this.direction(side);
    return out.set(nx * (PITCH.width / 2 - 1) * dir, y, (ny - 0.5) * PITCH.length * dir);
  }

  toTeam(side: Side, world: Vector3): { nx: number; ny: number } {
    const dir = this.direction(side);
    return { nx: world.x / (PITCH.width / 2 - 1) / dir, ny: world.z / PITCH.length / dir + 0.5 };
  }

  /** Centre of the goal that `attackingSide` is shooting at. */
  goalMouth(attackingSide: Side, out = new Vector3()): Vector3 {
    return out.set(0, 0, (PITCH.length / 2) * this.direction(attackingSide));
  }
}
