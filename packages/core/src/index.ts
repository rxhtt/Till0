/**
 * Core domain interfaces, money types, and deterministic utilities for Till0.
 * Pure TypeScript: No DOM or React imports allowed.
 */

import { ulid } from 'ulid';

/**
 * Money represented as integer paise (1 INR = 100 paise).
 * Floating-point currency calculations are strictly forbidden.
 */
export type Paise = number;

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
 * Format integer paise into standard Indian Rupee string representation (e.g., ₹1,234.50).
 *
 * @param amountInPaise - The monetary amount in integer paise.
 * @returns Formatted currency string without floating point inaccuracies.
 */
export function formatPaiseToRupees(amountInPaise: Paise): string {
  const isNegative = amountInPaise < 0;
  const abs = Math.abs(amountInPaise);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const paiseStr = paise.toString().padStart(2, '0');
  const prefix = isNegative ? '-₹' : '₹';
  return `${prefix}${rupees}.${paiseStr}`;
}

/**
 * Calculate line item total given integer unit price in paise and integer quantity.
 *
 * @param unitPricePaise - Price per unit in paise.
 * @param quantity - Number of units.
 * @returns Total amount in integer paise.
 */
export function calculateLineTotal(unitPricePaise: Paise, quantity: number): Paise {
  return Math.round(unitPricePaise * quantity);
}

/**
 * Generate a monotonic unique event identifier using ULID.
 *
 * @param clock - Injected Clock interface for deterministic timestamping.
 * @returns String ULID identifier.
 */
export function generateEventId(clock: Clock): string {
  return ulid(clock.now());
}

export type * from './api-types';

