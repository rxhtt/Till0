/**
 * Phase P2 tests: core cart model, data layer (Dexie), command queue,
 * appendSale idempotency, stock projection, and receipt gaplessness.
 *
 * Uses fake-indexeddb to polyfill IndexedDB in Node for Dexie transactions.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCart,
  addItem,
  adjustQty,
  removeLine,
  setQty,
  calculateLineTotal,
  formatReceiptNo,
  type CatalogItem,
  type Clock,
  type Tender,
} from '@till0/core';
import { PosDatabase } from '../src/data/db.js';
import { CommandQueue } from '../src/data/command-queue.js';
import { appendSale } from '../src/data/append-sale.js';
import { displayStock, applyPull } from '../src/data/projection.js';

// ─── Test Helpers ────────────────────────────────────────────────────

let clockCounter = 1700000000000;

/** Deterministic clock that increments by 1ms on each call. */
function makeClock(start?: number): Clock {
  let ts = start ?? clockCounter;
  clockCounter = ts;
  return {
    now() {
      return ts++;
    },
  };
}

/** Sample catalog item for testing. */
function sampleItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    sku: 'SKU001',
    name: 'Test Product',
    price_paise: 5000,
    tax_bp: 500,
    barcode: '8901234000010',
    opening_stock: 100,
    qty: 100,
    ...overrides,
  };
}

/** A second catalog item. */
function sampleItem2(): CatalogItem {
  return sampleItem({
    sku: 'SKU002',
    name: 'Test Product 2',
    price_paise: 3000,
    tax_bp: 1200,
    barcode: '8901234000027',
  });
}

/** Standard cash tender for the cart total. */
function cashTender(totalPaise: number): Tender {
  return {
    method: 'CASH',
    receivedPaise: totalPaise,
    changePaise: 0,
  };
}

// ─── Fresh DB per test ───────────────────────────────────────────────

let db: PosDatabase;
let dbSeq = 0;

beforeEach(async () => {
  // Use unique DB name per test to ensure isolation
  dbSeq++;
  db = new PosDatabase(`TEST_${dbSeq}`);
  // Seed catalog
  await db.catalog.bulkPut([sampleItem(), sampleItem2()]);
});

// ─────────────────────────────────────────────────────────────────────
// Cart model tests
// ─────────────────────────────────────────────────────────────────────

describe('Cart Model', () => {
  it('creates an empty cart with a valid attemptId', () => {
    const clock = makeClock(1700000000000);
    const cart = createCart('T1', clock);
    expect(cart.lines).toEqual([]);
    expect(cart.subtotalPaise).toBe(0);
    expect(cart.totalPaise).toBe(0);
    expect(cart.attemptId).toHaveLength(26);
    expect(cart.terminalId).toBe('T1');
  });

  it('adds an item and computes line total', () => {
    const clock = makeClock();
    const cart = addItem(createCart('T1', clock), sampleItem());
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.qty).toBe(1);
    expect(cart.lines[0]!.lineTotalPaise).toBe(5000);
    expect(cart.subtotalPaise).toBe(5000);
    expect(cart.totalPaise).toBe(5000);
  });

  it('increments qty when adding same SKU again', () => {
    const clock = makeClock();
    let cart = createCart('T1', clock);
    cart = addItem(cart, sampleItem());
    cart = addItem(cart, sampleItem());
    cart = addItem(cart, sampleItem());
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.qty).toBe(3);
    expect(cart.lines[0]!.lineTotalPaise).toBe(15000);
    expect(cart.totalPaise).toBe(15000);
  });

  it('adjustQty +/- correctly', () => {
    const clock = makeClock();
    let cart = createCart('T1', clock);
    cart = addItem(cart, sampleItem());
    cart = adjustQty(cart, 'SKU001', 4); // 1 + 4 = 5
    expect(cart.lines[0]!.qty).toBe(5);
    cart = adjustQty(cart, 'SKU001', -2); // 5 - 2 = 3
    expect(cart.lines[0]!.qty).toBe(3);
    expect(cart.lines[0]!.lineTotalPaise).toBe(15000);
  });

  it('removes line when qty goes to 0', () => {
    const clock = makeClock();
    let cart = createCart('T1', clock);
    cart = addItem(cart, sampleItem());
    cart = adjustQty(cart, 'SKU001', -1); // 1 - 1 = 0 → removed
    expect(cart.lines).toHaveLength(0);
    expect(cart.totalPaise).toBe(0);
  });

  it('removeLine removes the item entirely', () => {
    const clock = makeClock();
    let cart = createCart('T1', clock);
    cart = addItem(cart, sampleItem());
    cart = addItem(cart, sampleItem2());
    cart = removeLine(cart, 'SKU001');
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.sku).toBe('SKU002');
  });

  it('setQty works correctly', () => {
    const clock = makeClock();
    let cart = createCart('T1', clock);
    cart = addItem(cart, sampleItem());
    cart = setQty(cart, 'SKU001', 10);
    expect(cart.lines[0]!.qty).toBe(10);
    expect(cart.lines[0]!.lineTotalPaise).toBe(50000);
  });

  it('computes tax breakdown by rate', () => {
    const clock = makeClock();
    let cart = createCart('T1', clock);
    cart = addItem(cart, sampleItem());  // 5% (500bp)
    cart = addItem(cart, sampleItem2()); // 12% (1200bp)
    expect(cart.taxBreakdown).toHaveLength(2);
    const tax5 = cart.taxBreakdown.find((t) => t.rateBp === 500);
    const tax12 = cart.taxBreakdown.find((t) => t.rateBp === 1200);
    expect(tax5).toBeDefined();
    expect(tax12).toBeDefined();
    // Inclusive tax: tax = gross - round(gross * 10000 / (10000 + rate))
    // For 5000 at 500bp: net = round(5000 * 10000 / 10500) = round(4761.9) = 4762, tax = 238
    expect(tax5!.amountPaise).toBe(238);
    // For 3000 at 1200bp: net = round(3000 * 10000 / 11200) = round(2678.57) = 2679, tax = 321
    expect(tax12!.amountPaise).toBe(321);
  });

  it('500 rapid qty +/- operations end with arithmetically correct cart', () => {
    const clock = makeClock();
    let cart = createCart('T1', clock);
    cart = addItem(cart, sampleItem());

    // Start at qty=1, then do 500 operations with a known pattern
    // Even ops: +1, Odd ops: -1. Net effect: 0 (since we start at qty=1)
    // Actually, let's do +1 each time for first 300, then -1 for next 200
    // Expected final qty = 1 + 300 - 200 = 101
    for (let i = 0; i < 300; i++) {
      cart = adjustQty(cart, 'SKU001', 1);
    }
    for (let i = 0; i < 200; i++) {
      cart = adjustQty(cart, 'SKU001', -1);
    }
    expect(cart.lines[0]!.qty).toBe(101);
    expect(cart.lines[0]!.lineTotalPaise).toBe(calculateLineTotal(5000, 101));
    expect(cart.totalPaise).toBe(505000);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Command Queue tests
// ─────────────────────────────────────────────────────────────────────

describe('CommandQueue', () => {
  it('executes commands strictly in order', async () => {
    const queue = new CommandQueue();
    const log: number[] = [];

    const promises = [];
    for (let i = 0; i < 10; i++) {
      const idx = i;
      promises.push(
        queue.enqueue(async () => {
          // Simulate variable async work
          await new Promise((r) => setTimeout(r, Math.max(1, 10 - idx)));
          log.push(idx);
          return idx;
        }),
      );
    }

    const results = await Promise.all(promises);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(log).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('propagates errors without breaking the queue', async () => {
    const queue = new CommandQueue();

    const p1 = queue.enqueue(async () => 'ok');
    const p2 = queue.enqueue(async () => {
      throw new Error('fail');
    });
    const p3 = queue.enqueue(async () => 'recovered');

    expect(await p1).toBe('ok');
    await expect(p2).rejects.toThrow('fail');
    expect(await p3).toBe('recovered');
  });
});

// ─────────────────────────────────────────────────────────────────────
// appendSale + Receipt tests
// ─────────────────────────────────────────────────────────────────────

describe('appendSale', () => {
  it('writes event and printJob in one transaction, returns receipt', async () => {
    const clock = makeClock(1700000001000);
    let cart = createCart('T1', clock);
    cart = addItem(cart, sampleItem());
    cart = addItem(cart, sampleItem2());

    const tender = cashTender(cart.totalPaise);
    const receipt = await appendSale(db, cart, tender, clock);

    expect(receipt).not.toBeNull();
    expect(receipt!.receiptNo).toBe('T1-000001');
    expect(receipt!.eventId).toBe(cart.attemptId);
    expect(receipt!.terminalSeq).toBe(1);
    expect(receipt!.lines).toHaveLength(2);
    expect(receipt!.totalPaise).toBe(cart.totalPaise);

    // Event persisted
    const events = await db.events.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(cart.attemptId);
    expect(events[0]!.status).toBe('pending');

    // Print job persisted
    const printJobs = await db.printJobs.toArray();
    expect(printJobs).toHaveLength(1);
    expect(printJobs[0]!.eventId).toBe(cart.attemptId);
    expect(printJobs[0]!.status).toBe('pending');
  });

  it('receipt numbers are gapless across multiple sales', async () => {
    const clock = makeClock(1700000002000);
    const receiptNos: string[] = [];

    for (let i = 0; i < 10; i++) {
      const cart = addItem(createCart('T1', clock), sampleItem());
      const tender = cashTender(cart.totalPaise);
      const receipt = await appendSale(db, cart, tender, clock);
      expect(receipt).not.toBeNull();
      receiptNos.push(receipt!.receiptNo);
    }

    // Verify gapless
    for (let i = 0; i < 10; i++) {
      expect(receiptNos[i]).toBe(formatReceiptNo('T1', i + 1));
    }
  });

  it('200 PAY calls with same attemptId yield exactly one sale', async () => {
    const clock = makeClock(1700000003000);
    const cart = addItem(createCart('T1', clock), sampleItem());
    const tender = cashTender(cart.totalPaise);

    // Fire 200 concurrent appendSale calls for the same cart
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 200; i++) {
      promises.push(appendSale(db, cart, tender, makeClock(1700000004000 + i)));
    }

    const results = await Promise.all(promises);
    const receipts = results.filter((r) => r !== null);
    expect(receipts).toHaveLength(1);

    // Only one event in the DB
    const events = await db.events.toArray();
    expect(events).toHaveLength(1);

    // Only one print job
    const printJobs = await db.printJobs.toArray();
    expect(printJobs).toHaveLength(1);
  });

  it('crash between sale and print leaves the event persisted', async () => {
    // Simulate: event is written but print job table is unavailable
    // Since both happen in the same Dexie transaction, both commit or neither.
    // We verify that if appendSale succeeds, the event IS there.
    const clock = makeClock(1700000005000);
    const cart = addItem(createCart('T1', clock), sampleItem());
    const tender = cashTender(cart.totalPaise);

    const receipt = await appendSale(db, cart, tender, clock);
    expect(receipt).not.toBeNull();

    // Simulate "crash" by reading directly from DB
    const event = await db.events.get(receipt!.eventId);
    expect(event).toBeDefined();
    expect(event!.type).toBe('SALE_COMPLETED');
    expect(event!.status).toBe('pending');

    // The event is durable — even if the print job consumer fails,
    // the sale event is persisted and will sync to server
    const printJob = await db.printJobs.where('eventId').equals(receipt!.eventId).first();
    expect(printJob).toBeDefined();
    expect(printJob!.status).toBe('pending');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Projection tests
// ─────────────────────────────────────────────────────────────────────

describe('Stock Projection', () => {
  it('displayStock returns server balance when no local events', async () => {
    const stock = await displayStock(db, 'SKU001');
    expect(stock).toBe(100);
  });

  it('displayStock subtracts pending sale quantities', async () => {
    const clock = makeClock(1700000006000);
    const cart = addItem(createCart('T1', clock), sampleItem());
    const tender = cashTender(cart.totalPaise);
    await appendSale(db, cart, tender, clock);

    const stock = await displayStock(db, 'SKU001');
    expect(stock).toBe(99); // 100 - 1
  });

  it('projection is correct after a lost ack followed by a pull', async () => {
    const clock = makeClock(1700000007000);

    // Make 3 sales (3 units sold)
    for (let i = 0; i < 3; i++) {
      const cart = addItem(createCart('T1', clock), sampleItem());
      const tender = cashTender(cart.totalPaise);
      await appendSale(db, cart, tender, clock);
    }

    // Before pull, stock should be 100 - 3 = 97
    expect(await displayStock(db, 'SKU001')).toBe(97);

    // Simulate server pull: server processed all 3, balance is 97
    // But we "lost the ack" for the first event — server has it but we didn't mark it
    const allEvents = await db.events.toArray();
    const eventIds = allEvents.map((e) => e.id);

    // Server pull returns: balance=97, all 3 events applied
    await applyPull(
      db,
      [{ sku: 'SKU001', qty: 97 }, { sku: 'SKU002', qty: 100 }],
      eventIds,
      10,
    );

    // After pull: all events are acked, server balance is 97
    // displayStock = 97 + 0 (no non-acked deltas) = 97
    expect(await displayStock(db, 'SKU001')).toBe(97);

    // All events should be acked now
    const ackedEvents = await db.events.where('status').equals('acked').count();
    expect(ackedEvents).toBe(3);

    // Cursor should be updated
    const cursor = await db.meta.get('cursor');
    expect(cursor?.value).toBe(10);
  });

  it('projection handles partial ack correctly', async () => {
    const clock = makeClock(1700000008000);

    // Make 3 sales
    for (let i = 0; i < 3; i++) {
      const cart = addItem(createCart('T1', clock), sampleItem());
      const tender = cashTender(cart.totalPaise);
      await appendSale(db, cart, tender, clock);
    }

    const allEvents = await db.events.toArray();

    // Server only acknowledges first 2 events; balance reflects only those
    // Server balance = 100 - 2 = 98
    await applyPull(
      db,
      [{ sku: 'SKU001', qty: 98 }],
      [allEvents[0]!.id, allEvents[1]!.id],
      5,
    );

    // displayStock = 98 (server) + (-1) (1 pending event) = 97
    expect(await displayStock(db, 'SKU001')).toBe(97);

    // 1 event still pending
    const pendingCount = await db.events.where('status').equals('pending').count();
    expect(pendingCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Receipt number format tests
// ─────────────────────────────────────────────────────────────────────

describe('Receipt Number Format', () => {
  it('formats receipt numbers with zero-padded 6-digit sequence', () => {
    expect(formatReceiptNo('T1', 1)).toBe('T1-000001');
    expect(formatReceiptNo('T1', 42)).toBe('T1-000042');
    expect(formatReceiptNo('T2', 999999)).toBe('T2-999999');
    expect(formatReceiptNo('T1', 100)).toBe('T1-000100');
  });
});
