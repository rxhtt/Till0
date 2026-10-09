/**
 * Dexie database for the Till0 POS terminal.
 *
 * Database name: `pos-${terminalId}` (ADR 0008: per-terminal isolation).
 * Tables: catalog, events, meta, printJobs.
 */

import Dexie from 'dexie';
import type { Table } from 'dexie';
import type {
  CatalogItem,
  LocalEvent,
  MetaRow,
  PrintJob,
} from '@till0/core';

/**
 * Per-terminal Dexie database.
 *
 * Named `pos-${terminalId}` for complete storage isolation
 * between terminals running under the same origin (ADR 0008).
 */
export class PosDatabase extends Dexie {
  /** Product catalog cache. */
  catalog!: Table<CatalogItem, string>;
  /** Local event outbox (status: pending | sent | acked). */
  events!: Table<LocalEvent, string>;
  /** Key-value metadata (cursor, as_of, terminal_seq, receipt_seq). */
  meta!: Table<MetaRow, string>;
  /** Print job queue. */
  printJobs!: Table<PrintJob, number>;

  constructor(terminalId: string) {
    super(`pos-${terminalId}`);
    this.version(1).stores({
      catalog: 'sku, barcode',
      events: 'id, status, terminal_seq',
      meta: 'key',
      printJobs: '++id, eventId, status',
    });
  }
}

/**
 * Cache of open database instances keyed by terminal ID.
 * Prevents multiple Dexie instances for the same terminal.
 */
const dbCache = new Map<string, PosDatabase>();

/**
 * Get or create a PosDatabase instance for a given terminal.
 *
 * @param terminalId - Terminal identifier (e.g. "T1").
 * @returns The PosDatabase instance.
 */
export function getDb(terminalId: string): PosDatabase {
  let db = dbCache.get(terminalId);
  if (!db) {
    db = new PosDatabase(terminalId);
    dbCache.set(terminalId, db);
  }
  return db;
}

/**
 * Clear the database cache. Used in tests.
 */
export function clearDbCache(): void {
  dbCache.clear();
}
