import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  calculateLineTotal,
  formatPaiseToRupees,
  generateEventId,
  type Clock,
} from '../src/index';

describe('Core Money and Line Calculation', () => {
  it('formats positive and negative paise amounts accurately', () => {
    expect(formatPaiseToRupees(0)).toBe('₹0.00');
    expect(formatPaiseToRupees(99)).toBe('₹0.99');
    expect(formatPaiseToRupees(100)).toBe('₹1.00');
    expect(formatPaiseToRupees(15050)).toBe('₹150.50');
    expect(formatPaiseToRupees(-250)).toBe('-₹2.50');
  });

  it('calculates line item total deterministically', () => {
    expect(calculateLineTotal(4500, 3)).toBe(13500);
  });

  it('generates event IDs with injected clock', () => {
    const fixedClock: Clock = { now: () => 1712000000000 };
    const id1 = generateEventId(fixedClock);
    const id2 = generateEventId(fixedClock);
    expect(typeof id1).toBe('string');
    expect(id1.length).toBe(26);
    expect(id2.length).toBe(26);
  });

  it('property test: line total is always integer paise for integer inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (unitPrice, qty) => {
          const total = calculateLineTotal(unitPrice, qty);
          return Number.isInteger(total) && total === unitPrice * qty;
        }
      )
    );
  });
});
