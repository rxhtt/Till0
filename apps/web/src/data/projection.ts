/**
 * Stock projection: local display stock computation.
 *
 * displayStock(sku) = last server balance + sum of deltas of local events not yet acked.
 *
 * When a pull returns, balances are applied atomically, own_applied_ids are
 * marked acked, and stock is recomputed.
 */

import type { LocalEvent, SaleCompletedPayload } from '@till0/core';
import type { PosDatabase } from './db.js';

/**
 * Compute the display stock for a single SKU.
 *
 * Formula: server balance + sum of deltas from local non-acked events.
 *
 * @param db - The terminal's PosDatabase instance.
 * @param sku - The stock-keeping unit identifier.
 * @returns Projected stock quantity.
 */
export async function displayStock(db: PosDatabase, sku: string): Promise<number> {
  // Get the last known server balance from catalog
  const catalogItem = await db.catalog.get(sku);
  const serverQty = catalogItem?.qty ?? 0;

  // Sum deltas from local events that are not yet acked
  const localDelta = await computeLocalDelta(db, sku);

  return serverQty + localDelta;
}

/**
 * Compute the sum of stock deltas for a SKU from non-acked local events.
 *
 * SALE_COMPLETED events subtract quantity (negative delta).
 * STOCK_RECEIVED events add quantity (positive delta).
 */
async function computeLocalDelta(db: PosDatabase, sku: string): Promise<number> {
  const nonAcked = await db.events
    .where('status')
    .anyOf('pending', 'sent')
    .toArray();

  let delta = 0;
  for (const event of nonAcked) {
    delta += eventDeltaForSku(event, sku);
  }
  return delta;
}

/**
 * Extract the stock delta for a specific SKU from a single event.
 */
function eventDeltaForSku(event: LocalEvent, sku: string): number {
  if (event.type === 'SALE_COMPLETED') {
    const payload = event.payload as SaleCompletedPayload;
    for (const line of payload.lines) {
      if (line.sku === sku) {
        return -line.qty; // Sales decrease stock
      }
    }
  }
  // STOCK_RECEIVED would add, but not implemented in this phase
  return 0;
}

/**
 * Compute display stock for all SKUs in the catalog.
 *
 * @param db - The terminal's PosDatabase instance.
 * @returns Map of SKU → projected stock quantity.
 */
export async function displayStockAll(db: PosDatabase): Promise<Map<string, number>> {
  const catalog = await db.catalog.toArray();
  const nonAcked = await db.events
    .where('status')
    .anyOf('pending', 'sent')
    .toArray();

  const result = new Map<string, number>();

  for (const item of catalog) {
    let delta = 0;
    for (const event of nonAcked) {
      delta += eventDeltaForSku(event, item.sku);
    }
    result.set(item.sku, item.qty + delta);
  }

  return result;
}

/**
 * Apply a server pull response atomically:
 * 1. Update catalog balances from server snapshot.
 * 2. Mark own_applied_ids as acked.
 * 3. Update sync cursor metadata.
 *
 * @param db - The terminal's PosDatabase instance.
 * @param balances - Server stock snapshot (sku → qty).
 * @param ownAppliedIds - Event IDs that the server has confirmed applied.
 * @param asOfServerSeq - The server sequence number this pull is as-of.
 */
export async function applyPull(
  db: PosDatabase,
  balances: readonly { readonly sku: string; readonly qty: number }[],
  ownAppliedIds: readonly string[],
  asOfServerSeq: number,
): Promise<void> {
  await db.transaction('rw', [db.catalog, db.events, db.meta], async () => {
    // 1. Update catalog balances atomically
    for (const { sku, qty } of balances) {
      await db.catalog
        .where('sku')
        .equals(sku)
        .modify({ qty });
    }

    // 2. Mark own applied events as acked
    if (ownAppliedIds.length > 0) {
      await db.events
        .where('id')
        .anyOf([...ownAppliedIds])
        .modify({ status: 'acked' });
    }

    // 3. Update sync cursor
    await db.meta.put({ key: 'cursor', value: asOfServerSeq });
    await db.meta.put({ key: 'as_of', value: new Date().toISOString() });
  });
}
