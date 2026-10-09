/**
 * Core domain types for the Till0 POS system.
 * All monetary values are integer paise (1 INR = 100 paise).
 * No DOM or React imports allowed.
 */

import type { Paise } from './money.js';

// ─── Terminal ────────────────────────────────────────────────────────

/** Terminal identifier, e.g. "T1" or "T2". */
export type TerminalId = string;

// ─── Catalog ─────────────────────────────────────────────────────────

/** A product in the local catalog cache. */
export interface CatalogItem {
  /** Stock-keeping unit identifier. */
  readonly sku: string;
  /** Human-readable product name. */
  readonly name: string;
  /** Unit price in integer paise. */
  readonly price_paise: Paise;
  /** Tax rate in basis points (e.g. 500 = 5%). */
  readonly tax_bp: number;
  /** EAN-13 barcode string. */
  readonly barcode: string;
  /** Server-side opening stock quantity. */
  readonly opening_stock: number;
  /** Current stock balance from last server pull. */
  readonly qty: number;
}

// ─── Cart ────────────────────────────────────────────────────────────

/** A single line item in the cart. */
export interface CartLine {
  /** Stock-keeping unit identifier. */
  readonly sku: string;
  /** Product name (denormalized for display). */
  readonly name: string;
  /** Unit price in integer paise. */
  readonly unitPricePaise: Paise;
  /** Tax rate in basis points. */
  readonly taxBp: number;
  /** Quantity (always >= 1 while in cart). */
  readonly qty: number;
  /** Line total in integer paise: unitPricePaise * qty. */
  readonly lineTotalPaise: Paise;
}

/** Inclusive tax breakdown for a single tax rate. */
export interface TaxBreakdown {
  /** Tax rate in basis points. */
  readonly rateBp: number;
  /** Tax amount in integer paise (inclusive, extracted from line totals). */
  readonly amountPaise: Paise;
}

/** The shopping cart state. */
export interface Cart {
  /** Unique attempt identifier for this cart session (ULID). */
  readonly attemptId: string;
  /** Terminal this cart belongs to. */
  readonly terminalId: TerminalId;
  /** Ordered line items. */
  readonly lines: readonly CartLine[];
  /** Cart subtotal in integer paise (sum of all line totals). */
  readonly subtotalPaise: Paise;
  /** Inclusive tax breakdown by rate. */
  readonly taxBreakdown: readonly TaxBreakdown[];
  /** Grand total in integer paise (equals subtotalPaise — tax is inclusive). */
  readonly totalPaise: Paise;
}

// ─── Tender ──────────────────────────────────────────────────────────

/** Payment method discriminator. */
export type TenderMethod = 'CASH' | 'UPI';

/** Payment tender details. */
export interface Tender {
  /** Payment method. */
  readonly method: TenderMethod;
  /** Amount received in integer paise. */
  readonly receivedPaise: Paise;
  /** Change returned in integer paise (only for CASH). */
  readonly changePaise: Paise;
}

// ─── Receipt ─────────────────────────────────────────────────────────

/** Receipt line item for printing. */
export interface ReceiptLine {
  readonly name: string;
  readonly qty: number;
  readonly unitPricePaise: Paise;
  readonly lineTotalPaise: Paise;
}

/** A completed sale receipt. */
export interface Receipt {
  /** Gapless receipt number like "T1-000042". */
  readonly receiptNo: string;
  /** ULID event identifier for this sale. */
  readonly eventId: string;
  /** Terminal identifier. */
  readonly terminalId: TerminalId;
  /** Terminal sequence number for this event. */
  readonly terminalSeq: number;
  /** ISO-8601 timestamp of the sale. */
  readonly timestamp: string;
  /** Line items. */
  readonly lines: readonly ReceiptLine[];
  /** Subtotal in integer paise. */
  readonly subtotalPaise: Paise;
  /** Inclusive tax breakdown. */
  readonly taxBreakdown: readonly TaxBreakdown[];
  /** Grand total in integer paise. */
  readonly totalPaise: Paise;
  /** Tender details. */
  readonly tender: Tender;
}

// ─── Events ──────────────────────────────────────────────────────────

/** Event types matching server-side enum. */
export type EventType = 'SALE_COMPLETED' | 'STOCK_RECEIVED';

/** Outbox event status for sync. */
export type EventStatus = 'pending' | 'sent' | 'acked';

/** Sale line in event payload. */
export interface SalePayloadLine {
  readonly sku: string;
  readonly qty: number;
  readonly unit_price_paise: Paise;
  readonly line_total_paise: Paise;
}

/** Payload shape for SALE_COMPLETED events. */
export interface SaleCompletedPayload {
  readonly receipt_no: string;
  readonly lines: readonly SalePayloadLine[];
  readonly subtotal_paise: Paise;
  readonly total_paise: Paise;
  readonly tender_method: TenderMethod;
  readonly received_paise: Paise;
  readonly change_paise: Paise;
}

/** A local event stored in IndexedDB outbox. */
export interface LocalEvent {
  /** ULID event identifier. */
  readonly id: string;
  /** Terminal identifier. */
  readonly terminal_id: TerminalId;
  /** Per-terminal monotonic sequence number. */
  readonly terminal_seq: number;
  /** Event type discriminator. */
  readonly type: EventType;
  /** Event payload (type-specific). */
  readonly payload: SaleCompletedPayload | Record<string, unknown>;
  /** ISO-8601 client timestamp. */
  readonly client_ts: string;
  /** Sync status. */
  status: EventStatus;
}

// ─── Sync Meta ───────────────────────────────────────────────────────

/** Key-value metadata stored in the 'meta' table. */
export interface MetaRow {
  /** Key name (e.g. "cursor", "as_of"). */
  readonly key: string;
  /** Stored value. */
  value: string | number;
}

// ─── Print Jobs ──────────────────────────────────────────────────────

/** Print job status. */
export type PrintJobStatus = 'pending' | 'done' | 'failed';

/** A queued print job. */
export interface PrintJob {
  /** Auto-incremented primary key. */
  id?: number;
  /** Associated event ID. */
  readonly eventId: string;
  /** Serialized receipt for printing. */
  readonly receipt: Receipt;
  /** Print status. */
  status: PrintJobStatus;
  /** ISO-8601 timestamp when job was created. */
  readonly createdAt: string;
}

// ─── API Schema Type Aliases ──────────────────────────────────────────

import type { components } from './api-types.js';


export type ProductOut = components['schemas']['ProductOut'];
export type PushBatch = components['schemas']['PushBatch'];
export type PushEvent = components['schemas']['PushEvent'];
export type PushEventResult = components['schemas']['PushEventResult'];
export type PushResponse = components['schemas']['PushResponse'];
export type PullResponse = components['schemas']['PullResponse'];
export type StoredEvent = components['schemas']['StoredEvent'];
export type StockSnapshot = components['schemas']['StockSnapshot'];
export type AuditResponse = components['schemas']['AuditResponse'];
export type AuditSkuRow = components['schemas']['AuditSkuRow'];
export type HealthResponse = components['schemas']['HealthResponse'];
export type LedgerResponse = components['schemas']['LedgerResponse'];
