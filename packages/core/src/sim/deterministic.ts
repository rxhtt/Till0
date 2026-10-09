/**
 * Deterministic virtual clock and linear congruential generator (LCG) PRNG.
 */

import type { Clock, Rng } from '../clock.js';

export class VirtualClock implements Clock {
  private currentMs: number;

  constructor(startMs = 1700000000000) {
    this.currentMs = startMs;
  }

  public now(): number {
    return this.currentMs;
  }

  public advance(ms: number): void {
    if (ms < 0) throw new Error('Cannot move clock backwards');
    this.currentMs += ms;
  }

  public set(ms: number): void {
    this.currentMs = ms;
  }
}

/**
 * Seeded deterministic PRNG using standard 32-bit linear congruential generator (LCG).
 * Numerical Recipes parameters: multiplier = 1664525, increment = 1013904223.
 */
export class SeededRng implements Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    // Step once to discard initial correlation
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
  }

  /**
   * Returns a deterministic pseudo-random float in [0, 1).
   */
  public next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  /**
   * Returns a deterministic integer in range [min, max] inclusive.
   */
  public nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  /**
   * Returns true with given probability [0, 1].
   */
  public nextBool(prob = 0.5): boolean {
    return this.next() < prob;
  }

  /**
   * Pick a random element from an array.
   */
  public pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Cannot pick from empty array');
    const idx = Math.floor(this.next() * arr.length);
    return arr[idx]!;
  }
}
