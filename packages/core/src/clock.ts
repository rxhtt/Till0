/**
 * Deterministic interfaces for Clock and Rng injection.
 * Pure TypeScript: No DOM or React imports allowed.
 */

/**
 * Clock abstraction for deterministic time injection.
 */
export interface Clock {
  /**
   * Returns current unix timestamp in milliseconds.
   */
  now(): number;
}

/**
 * Rng abstraction for deterministic random number generation.
 */
export interface Rng {
  /**
   * Returns a pseudo-random number in range [0, 1).
   */
  next(): number;
}

/**
 * System clock implementation using Date.now().
 * Used in production; tests inject a fake Clock.
 */
export const SystemClock: Clock = {
  now: () => Date.now(),
};

/**
 * System RNG implementation using Math.random().
 * Used in production; tests inject a seeded Rng.
 */
export const SystemRng: Rng = {
  next: () => Math.random(),
};
