/**
 * Pure cart model — immutable state transitions for the shopping cart.
 * All money in integer paise. No DOM or React imports.
 */

import { ulid } from 'ulid';
import type { Clock } from './clock.js';
import { calculateLineTotal, extractInclusiveTax } from './money.js';
import type { Paise } from './money.js';
import type { Cart, CartLine, CatalogItem, TaxBreakdown } from './types.js';

/**
 * Recompute subtotal, tax breakdown, and total from lines.
 */
function recomputeTotals(
  lines: readonly CartLine[],
  attemptId: string,
  terminalId: string,
): Cart {
  const subtotalPaise = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  // Group inclusive tax by rate
  const taxMap = new Map<number, number>();
  for (const line of lines) {
    const tax = extractInclusiveTax(line.lineTotalPaise, line.taxBp);
    const prev = taxMap.get(line.taxBp) ?? 0;
    taxMap.set(line.taxBp, prev + tax);
  }
  const taxBreakdown: TaxBreakdown[] = [];
  for (const [rateBp, amountPaise] of taxMap) {
    taxBreakdown.push({ rateBp, amountPaise });
  }
  taxBreakdown.sort((a, b) => a.rateBp - b.rateBp);

  return {
    attemptId,
    terminalId,
    lines,
    subtotalPaise,
    taxBreakdown,
    totalPaise: subtotalPaise, // inclusive — total equals subtotal
  };
}

/**
 * Create a new empty cart with a fresh attempt_id.
 *
 * @param terminalId - Terminal identifier (e.g. "T1").
 * @param clock - Injected clock for deterministic ULID generation.
 */
export function createCart(terminalId: string, clock: Clock): Cart {
  const attemptId = ulid(clock.now());
  return {
    attemptId,
    terminalId,
    lines: [],
    subtotalPaise: 0,
    taxBreakdown: [],
    totalPaise: 0,
  };
}

/**
 * Add one unit of a catalog item to the cart, or increment if already present.
 */
export function addItem(cart: Cart, item: CatalogItem): Cart {
  const existing = cart.lines.findIndex((l) => l.sku === item.sku);
  let newLines: CartLine[];
  if (existing >= 0) {
    const line = cart.lines[existing]!;
    const newQty = line.qty + 1;
    const newLine: CartLine = {
      ...line,
      qty: newQty,
      lineTotalPaise: calculateLineTotal(line.unitPricePaise, newQty),
    };
    newLines = cart.lines.map((l, i) => (i === existing ? newLine : l));
  } else {
    const newLine: CartLine = {
      sku: item.sku,
      name: item.name,
      unitPricePaise: item.price_paise,
      taxBp: item.tax_bp,
      qty: 1,
      lineTotalPaise: item.price_paise,
    };
    newLines = [...cart.lines, newLine];
  }
  return recomputeTotals(newLines, cart.attemptId, cart.terminalId);
}

/**
 * Set the quantity of a line item. If qty <= 0, the line is removed.
 */
export function setQty(cart: Cart, sku: string, qty: number): Cart {
  if (qty <= 0) {
    return removeLine(cart, sku);
  }
  const newLines = cart.lines.map((l) => {
    if (l.sku !== sku) return l;
    return {
      ...l,
      qty,
      lineTotalPaise: calculateLineTotal(l.unitPricePaise, qty),
    };
  });
  return recomputeTotals(newLines, cart.attemptId, cart.terminalId);
}

/**
 * Increment quantity of a line item by delta (can be negative).
 * If resulting qty <= 0, the line is removed.
 */
export function adjustQty(cart: Cart, sku: string, delta: number): Cart {
  const line = cart.lines.find((l) => l.sku === sku);
  if (!line) return cart;
  return setQty(cart, sku, line.qty + delta);
}

/**
 * Remove a line item from the cart entirely.
 */
export function removeLine(cart: Cart, sku: string): Cart {
  const newLines = cart.lines.filter((l) => l.sku !== sku);
  return recomputeTotals(newLines, cart.attemptId, cart.terminalId);
}

/**
 * Check if cart is empty.
 */
export function isCartEmpty(cart: Cart): boolean {
  return cart.lines.length === 0;
}

/**
 * Compute inclusive tax for a given gross amount and rate in basis points.
 * Re-exported for convenience.
 */
export { extractInclusiveTax } from './money.js';

/**
 * Type guard: ensure cart total is positive (needed before payment).
 */
export function canCheckout(cart: Cart): boolean {
  return cart.lines.length > 0 && cart.totalPaise > 0;
}

/**
 * Compute the total quantity of items across all lines.
 */
export function totalItemCount(cart: Cart): number {
  return cart.lines.reduce((sum, l) => sum + l.qty, 0);
}

/**
 * Compute the change due for cash payment.
 *
 * @param totalPaise - Cart total in integer paise.
 * @param receivedPaise - Cash received in integer paise.
 * @returns Change due in integer paise (0 if receivedPaise < totalPaise).
 */
export function computeChange(totalPaise: Paise, receivedPaise: Paise): Paise {
  return Math.max(0, receivedPaise - totalPaise);
}
