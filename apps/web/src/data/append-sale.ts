/**
 * appendSale: write SALE_COMPLETED event + outbox row in ONE Dexie transaction.
 *
 * The sale event_id is derived from the cart's attempt_id, so pressing PAY
 * many times or retrying after a crash yields exactly one sale (ADR 0013).
 *
 * Also enqueues a print job in the same transaction.
 */

import type {
  Cart,
  Clock,
  LocalEvent,
  PrintJob,
  Receipt,
  SaleCompletedPayload,
  Tender,
} from '@till0/core';
import { buildReceipt, formatReceiptNo } from '@till0/core';
import type { PosDatabase } from './db.js';

/**
 * Append a SALE_COMPLETED event and print job atomically in one Dexie transaction.
 *
 * The event_id is deterministically derived from the cart's attemptId,
 * guaranteeing idempotency: the same attemptId always produces the same eventId
 * (ADR 0013). If the event already exists, the transaction is skipped.
 *
 * @param db - The terminal's PosDatabase instance.
 * @param cart - The finalized cart.
 * @param tender - Payment details.
 * @param clock - Injected clock for timestamps and ULID generation.
 * @returns The receipt model, or null if this attemptId was already consumed.
 */
export async function appendSale(
  db: PosDatabase,
  cart: Cart,
  tender: Tender,
  clock: Clock,
): Promise<Receipt | null> {
  // The event_id IS the attempt_id — same cart session, same event.
  const eventId = cart.attemptId;

  // Check for prior completion (idempotency guard)
  const existing = await db.events.get(eventId);
  if (existing) {
    return null; // Already completed — no duplicate sale
  }

  // All the rest happens in ONE Dexie transaction
  const receipt = await db.transaction(
    'rw',
    [db.events, db.meta, db.printJobs],
    async () => {
      // Double-check inside transaction (another tab could race)
      const doubleCheck = await db.events.get(eventId);
      if (doubleCheck) {
        return null;
      }

      // Increment terminal_seq
      const seqRow = await db.meta.get('terminal_seq');
      const terminalSeq = seqRow ? (seqRow.value as number) + 1 : 1;
      await db.meta.put({ key: 'terminal_seq', value: terminalSeq });

      // Increment receipt_seq (gapless per-terminal receipt numbers, ADR 0005)
      const receiptRow = await db.meta.get('receipt_seq');
      const receiptSeq = receiptRow ? (receiptRow.value as number) + 1 : 1;
      await db.meta.put({ key: 'receipt_seq', value: receiptSeq });

      const receiptNo = formatReceiptNo(cart.terminalId, receiptSeq);

      // Build receipt model
      const rcpt = buildReceipt(cart, tender, eventId, terminalSeq, receiptNo, clock);

      // Build SALE_COMPLETED event payload
      const payload: SaleCompletedPayload = {
        receipt_no: receiptNo,
        lines: cart.lines.map((l) => ({
          sku: l.sku,
          qty: l.qty,
          unit_price_paise: l.unitPricePaise,
          line_total_paise: l.lineTotalPaise,
        })),
        subtotal_paise: cart.subtotalPaise,
        total_paise: cart.totalPaise,
        tender_method: tender.method,
        received_paise: tender.receivedPaise,
        change_paise: tender.changePaise,
      };

      // Write event to outbox
      const event: LocalEvent = {
        id: eventId,
        terminal_id: cart.terminalId,
        terminal_seq: terminalSeq,
        type: 'SALE_COMPLETED',
        payload,
        client_ts: new Date(clock.now()).toISOString(),
        status: 'pending',
      };
      await db.events.add(event);

      // Enqueue print job
      const printJob: PrintJob = {
        eventId,
        receipt: rcpt,
        status: 'pending',
        createdAt: new Date(clock.now()).toISOString(),
      };
      await db.printJobs.add(printJob);

      return rcpt;
    },
  );

  return receipt;
}
