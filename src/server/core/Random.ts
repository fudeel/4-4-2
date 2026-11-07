/** Source of randomness for the match engine. Injected so matches can be replayed and tested deterministically. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
  shuffle<T>(items: readonly T[]): T[];
}

abstract class BaseRng implements Rng {
  abstract next(): number;

  int(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Cannot pick from an empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    if (items.length === 0) throw new Error('Cannot pick from an empty list');
    const weights = items.map(item => Math.max(0, weightOf(item)));
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }
}

/** Mulberry32: tiny, fast, seedable PRNG. */
export class SeededRng extends BaseRng {
  private state: number;

  constructor(seed: number = Date.now()) {
    super();
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
