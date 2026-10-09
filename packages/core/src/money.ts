/**
 * Money arithmetic in integer paise (1 INR = 100 paise).
 * No floating-point operations on currency values.
 * Pure TypeScript: No DOM or React imports allowed.
 */

/**
 * Money represented as integer paise (1 INR = 100 paise).
 * Floating-point currency calculations are strictly forbidden.
 */
export type Paise = number;

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
 * Extract inclusive tax from a gross amount given a tax rate in basis points.
 *
 * Formula: tax = gross - Math.round(gross * 10000 / (10000 + rateBp))
 * This ensures taxable + tax = gross exactly (no rounding drift).
 *
 * @param grossPaise - Total gross amount in integer paise (tax-inclusive).
 * @param rateBp - Tax rate in basis points (e.g. 500 = 5%).
 * @returns Tax portion in integer paise.
 */
export function extractInclusiveTax(grossPaise: Paise, rateBp: number): Paise {
  if (rateBp <= 0) return 0;
  const netPaise = Math.round(grossPaise * 10000 / (10000 + rateBp));
  return grossPaise - netPaise;
}
