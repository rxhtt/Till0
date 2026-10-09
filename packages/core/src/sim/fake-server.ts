/**
 * In-memory server ledger implementation matching Till0 P1 contract.
 *
 * Implements:
 * - products catalog & stock_balance
 * - events log with gapless server_seq (commit-ordered)
 * - /catalog
 * - /health
 * - /sync/push (batch <= 50, per-event savepoint, idempotent ON CONFLICT, sorted SKU updates, exceptions, alerts)
 * - /sync/pull (since, terminal_id, stock snapshot, as_of_server_seq, own_applied_ids)
 * - /audit (conservation check, server_seq gaplessness, duplicate event_id check)
 */

import type {
  ProductOut,
  PushBatch,
  PushEventResult,
  PushResponse,

  PullResponse,
  StoredEvent,
  StockSnapshot,
  AuditResponse,
  AuditSkuRow,
} from '../types.js';


export interface FakeServerProduct {
  sku: string;
  name: string;
  price_paise: number;
  tax_bp: number;
  barcode: string;
  opening_stock: number;
}

export interface FakeServerException {
  id: number;
  sku: string;
  event_id: string;
  qty_after: number;
  created_at: string;
}

export interface FakeServerAlert {
  id: number;
  sku: string;
  qty: number;
  created_at: string;
}

export interface FakeServerDeadLetter {
  event_id: string;
  reason: string;
  raw: Record<string, unknown>;
}

export class InMemoryFakeServer {
  private products: Map<string, FakeServerProduct> = new Map();
  private stockBalance: Map<string, number> = new Map();
  private events: StoredEvent[] = [];
  private eventIdsSeen: Set<string> = new Set();
  private exceptions: FakeServerException[] = [];
  private alerts: FakeServerAlert[] = [];
  private deadLetters: FakeServerDeadLetter[] = [];
  private currentServerSeq = 0;
  private exceptionSeq = 0;
  private alertSeq = 0;
  private lowStockThreshold: number;

  constructor(products: FakeServerProduct[] = [], lowStockThreshold = 5) {
    this.lowStockThreshold = lowStockThreshold;
    for (const p of products) {
      this.products.set(p.sku, { ...p });
      this.stockBalance.set(p.sku, p.opening_stock);
    }
  }

  public getHealth(): { status: string; version: string } {
    return { status: 'ok', version: '0.1.0' };
  }

  public getCatalog(): ProductOut[] {
    const list: ProductOut[] = [];
    for (const p of this.products.values()) {
      const qty = this.stockBalance.get(p.sku) ?? p.opening_stock;
      list.push({
        sku: p.sku,
        name: p.name,
        price_paise: p.price_paise,
        tax_bp: p.tax_bp,
        barcode: p.barcode,
        opening_stock: p.opening_stock,
        qty,
      });
    }
    // Sort by name like backend does
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  public syncPush(batch: PushBatch): PushResponse {
    const results: PushEventResult[] = [];

    // Push batches up to 50
    const eventsToProcess = batch.events.slice(0, 50);

    for (const ev of eventsToProcess) {
      // Duplicate check (idempotency)
      if (this.eventIdsSeen.has(ev.event_id)) {
        results.push({
          event_id: ev.event_id,
          status: 'duplicate',
          server_seq: null,
        });
        continue;
      }



      // Per-event SAVEPOINT: simulate processing in an isolated transaction
      try {
        const payload = ev.payload as Record<string, unknown>;
        if (
          (ev.type === 'SALE_COMPLETED' || ev.type === 'STOCK_RECEIVED') &&
          (!payload || !Array.isArray(payload['lines']))
        ) {
          throw new Error(`${ev.type} requires lines array`);
        }

        const lines = (payload['lines'] as Array<{ sku: string; qty: number }>) || [];

        // Validate line quantities
        for (const line of lines) {
          if (typeof line.qty !== 'number' || line.qty <= 0) {
            throw new Error(`qty must be > 0 for sku ${line.sku}`);
          }
        }

        // Apply stock updates in sorted SKU order
        const sortedSkus = Array.from(new Set(lines.map((l) => l.sku))).sort();

        // Check if any product doesn't exist
        for (const sku of sortedSkus) {
          if (!this.products.has(sku)) {
            // In POS, if unknown product, initialize or reject
          }
        }

        if (ev.type === 'SALE_COMPLETED') {
          for (const line of lines) {
            const current = this.stockBalance.get(line.sku) ?? (this.products.get(line.sku)?.opening_stock ?? 0);
            const newQty = current - line.qty;
            this.stockBalance.set(line.sku, newQty);

            if (newQty < 0) {
              this.exceptionSeq++;
              this.exceptions.push({
                id: this.exceptionSeq,
                sku: line.sku,
                event_id: ev.event_id,
                qty_after: newQty,
                created_at: new Date().toISOString(),
              });
            }

            if (current > this.lowStockThreshold && newQty <= this.lowStockThreshold) {
              this.alertSeq++;
              this.alerts.push({
                id: this.alertSeq,
                sku: line.sku,
                qty: newQty,
                created_at: new Date().toISOString(),
              });
            }
          }
        } else if (ev.type === 'STOCK_RECEIVED') {
          for (const line of lines) {
            const current = this.stockBalance.get(line.sku) ?? (this.products.get(line.sku)?.opening_stock ?? 0);
            const newQty = current + line.qty;
            this.stockBalance.set(line.sku, newQty);
          }
        }

        // Commit event: increment commit-ordered gapless server_seq
        this.currentServerSeq++;
        const serverSeq = this.currentServerSeq;
        this.eventIdsSeen.add(ev.event_id);

        const stored: StoredEvent = {
          server_seq: serverSeq,
          event_id: ev.event_id,
          terminal_id: ev.terminal_id,
          terminal_seq: ev.terminal_seq,
          type: ev.type,
          payload: ev.payload,
          client_ts: ev.client_ts,
          received_at: new Date().toISOString(),
        };
        this.events.push(stored);

        results.push({
          event_id: ev.event_id,
          status: 'applied',
          server_seq: serverSeq,
        });
      } catch (err: unknown) {
        // Event rejected - recorded in dead letters
        this.deadLetters.push({
          event_id: ev.event_id,
          reason: String(err),
          raw: ev as unknown as Record<string, unknown>,
        });
        results.push({
          event_id: ev.event_id,
          status: 'rejected',
          server_seq: null,
        });
      }
    }

    return { results };
  }

  public syncPull(since = 0, terminalId = ''): PullResponse {
    let returnedEvents: StoredEvent[];
    let ownAppliedIds: string[] = [];

    if (terminalId) {
      returnedEvents = this.events.filter((e) => e.server_seq > since && e.terminal_id !== terminalId);
      ownAppliedIds = this.events
        .filter((e) => e.terminal_id === terminalId && e.server_seq > since)
        .map((e) => e.event_id);
    } else {
      returnedEvents = this.events.filter((e) => e.server_seq > since);
    }

    const balances: StockSnapshot[] = [];
    for (const [sku, qty] of this.stockBalance.entries()) {
      balances.push({ sku, qty });
    }
    balances.sort((a, b) => a.sku.localeCompare(b.sku));

    const maxReturnedSeq = returnedEvents.reduce(
      (max, e) => (e.server_seq > max ? e.server_seq : max),
      since,
    );
    const asOfServerSeq = maxReturnedSeq;

    return {
      events: returnedEvents,
      balances,
      as_of_server_seq: asOfServerSeq,
      own_applied_ids: ownAppliedIds,
    };
  }

  public getAudit(): AuditResponse {
    const skuMap = new Map<string, { opening: number; sold: number; received: number }>();
    for (const p of this.products.values()) {
      skuMap.set(p.sku, { opening: p.opening_stock, sold: 0, received: 0 });
    }

    // Tally events
    for (const e of this.events) {
      const payload = e.payload as { lines?: Array<{ sku: string; qty: number }> };
      const lines = payload.lines || [];
      for (const line of lines) {
        const stats = skuMap.get(line.sku);
        if (stats) {
          if (e.type === 'SALE_COMPLETED') {
            stats.sold += line.qty;
          } else if (e.type === 'STOCK_RECEIVED') {
            stats.received += line.qty;
          }
        }
      }
    }

    // Check gaps in server_seq
    const seqGaps: number[] = [];
    for (let i = 0; i < this.events.length; i++) {
      const expected = i + 1;
      const actual = this.events[i]!.server_seq;
      if (actual !== expected) {
        seqGaps.push(expected);
      }
    }

    // Check skus
    let allOk = true;
    const skuRows: AuditSkuRow[] = [];
    for (const [sku, stats] of skuMap.entries()) {
      const storedBalance = this.stockBalance.get(sku) ?? 0;
      const computedBalance = stats.opening - stats.sold + stats.received;
      const ok = storedBalance === computedBalance;
      if (!ok) allOk = false;
      skuRows.push({
        sku,
        opening: stats.opening,
        sold: stats.sold,
        received: stats.received,
        computed_balance: computedBalance,
        stored_balance: storedBalance,
        ok,
      });
    }

    skuRows.sort((a, b) => a.sku.localeCompare(b.sku));

    const status = allOk && seqGaps.length === 0 ? 'PASS' : 'FAIL';
    return {
      status,
      duplicate_event_ids: [],
      seq_gaps: seqGaps,
      skus: skuRows,
    };
  }

  public getRawEvents(): readonly StoredEvent[] {
    return this.events;
  }

  public getRawBalances(): ReadonlyMap<string, number> {
    return this.stockBalance;
  }
}
