/**
 * Receipt model construction from cart + tender.
 * Pure TypeScript: No DOM or React imports.
 */

import type { Cart, Receipt, ReceiptLine, Tender, TerminalId } from './types.js';
import type { Clock } from './clock.js';

/**
 * Format a receipt number with terminal prefix and zero-padded sequence.
 * E.g. formatReceiptNo("T1", 42) => "T1-000042"
 *
 * @param terminalId - Terminal identifier.
 * @param seq - Gapless sequence number.
 */
export function formatReceiptNo(terminalId: TerminalId, seq: number): string {
  return `${terminalId}-${seq.toString().padStart(6, '0')}`;
}

/**
 * Build a Receipt from a completed cart, tender, and sequence metadata.
 *
 * @param cart - The finalized cart.
 * @param tender - Payment tender details.
 * @param eventId - ULID event identifier.
 * @param terminalSeq - Per-terminal monotonic sequence.
 * @param receiptNo - Gapless receipt number string.
 * @param clock - Injected clock for timestamp.
 */
export function buildReceipt(
  cart: Cart,
  tender: Tender,
  eventId: string,
  terminalSeq: number,
  receiptNo: string,
  clock: Clock,
): Receipt {
  const lines: ReceiptLine[] = cart.lines.map((l) => ({
    name: l.name,
    qty: l.qty,
    unitPricePaise: l.unitPricePaise,
    lineTotalPaise: l.lineTotalPaise,
  }));

  return {
    receiptNo,
    eventId,
    terminalId: cart.terminalId,
    terminalSeq,
    timestamp: new Date(clock.now()).toISOString(),
    lines,
    subtotalPaise: cart.subtotalPaise,
    taxBreakdown: [...cart.taxBreakdown],
    totalPaise: cart.totalPaise,
    tender,
  };
}
