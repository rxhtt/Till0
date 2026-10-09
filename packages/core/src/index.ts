/**
 * Core domain interfaces, money types, and deterministic utilities for Till0.
 * Pure TypeScript: No DOM or React imports allowed.
 */

import { ulid } from 'ulid';
import type { Clock } from './clock.js';

// Re-export everything from submodules
export * from './types.js';
export * from './money.js';
export * from './clock.js';
export * from './cart.js';
export * from './receipt.js';
export * from './network-gate.js';
export * from './sync-storage.js';
export * from './sync-engine.js';
export * from './sim/index.js';

/**
 * Generate a monotonic unique event identifier using ULID.
 *
 * @param clock - Injected Clock interface for deterministic timestamping.
 * @returns String ULID identifier.
 */
export function generateEventId(clock: Clock): string {
  return ulid(clock.now());
}

export type * from './api-types.js';

