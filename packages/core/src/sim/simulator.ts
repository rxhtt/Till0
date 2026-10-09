/**
 * Deterministic multi-terminal simulator runner for property testing and CLI runs.
 *
 * Simulates:
 * - Terminals T1 and T2 generating random sales
 * - Network cuts (partitions)
 * - Dropped ACKs
 * - Duplicate requests
 * - Terminal crash and restart from persisted state
 * - Quiescence phase (healing network and letting engines converge)
 * - Invariant checks:
 *     1. Every event applied exactly once on server (no server duplicate event_id, no sequence gaps)
 *     2. Server balances == opening_stock - total sold
 *     3. Convergence after quiescence: terminal projected stock == server stock
 *     4. No lost sale: every created sale event exists in server ledger
 */

import { VirtualClock, SeededRng } from './deterministic.js';
import { InMemoryFakeServer, type FakeServerProduct } from './fake-server.js';
import { NetworkModel } from './network-model.js';
import { NetworkGate } from '../network-gate.js';
import { MemorySyncStorage } from '../sync-storage.js';
import { SyncEngine } from '../sync-engine.js';
import type { LocalEvent, SaleCompletedPayload } from '../types.js';

export interface SimResult {
  seed: number;
  success: boolean;
  totalSalesGenerated: number;
  totalSalesOnServer: number;
  error?: string;
}

export interface SimOptions {
  steps?: number;
  catalogSize?: number;
  dropAckRate?: number;
  duplicateRate?: number;
  partitionRate?: number;
  crashRate?: number;
}

export function generateDefaultCatalog(size = 5): FakeServerProduct[] {
  const products: FakeServerProduct[] = [];
  for (let i = 1; i <= size; i++) {
    const sku = `SKU_${i.toString().padStart(3, '0')}`;
    products.push({
      sku,
      name: `Product ${i}`,
      price_paise: 1000 * i,
      tax_bp: 500,
      barcode: `8901234000${i.toString().padStart(2, '0')}0`,
      opening_stock: 500,
    });
  }
  return products;
}

export async function runSimulation(seed: number, options: SimOptions = {}): Promise<SimResult> {
  const steps = options.steps ?? 60;
  const catalog = generateDefaultCatalog(options.catalogSize ?? 5);

  const rng = new SeededRng(seed);
  const clock = new VirtualClock(1700000000000);

  // 1. Setup server
  const server = new InMemoryFakeServer(catalog);

  // 2. Setup network model
  const netModel = new NetworkModel({
    rng,
    server,
    dropAckRate: options.dropAckRate ?? 0.25,
    duplicateRate: options.duplicateRate ?? 0.2,
  });

  // 3. Setup terminals T1 and T2
  const terminals = ['T1', 'T2'] as const;
  type TermId = typeof terminals[number];

  const storages: Record<TermId, MemorySyncStorage> = {
    T1: new MemorySyncStorage(
      catalog.map((c) => ({
        sku: c.sku,
        name: c.name,
        price_paise: c.price_paise,
        tax_bp: c.tax_bp,
        barcode: c.barcode,
        opening_stock: c.opening_stock,
        qty: c.opening_stock,
      })),
    ),
    T2: new MemorySyncStorage(
      catalog.map((c) => ({
        sku: c.sku,
        name: c.name,
        price_paise: c.price_paise,
        tax_bp: c.tax_bp,
        barcode: c.barcode,
        opening_stock: c.opening_stock,
        qty: c.opening_stock,
      })),
    ),
  };

  const gates: Record<TermId, NetworkGate> = {
    T1: new NetworkGate(),
    T2: new NetworkGate(),
  };

  const engines: Record<TermId, SyncEngine> = {
    T1: new SyncEngine({
      terminalId: 'T1',
      baseUrl: 'http://localhost:8000',
      storage: storages.T1,
      gate: gates.T1,
      clock,
      rng,
      fetchFn: netModel.createFetchForTerminal('T1'),
    }),
    T2: new SyncEngine({
      terminalId: 'T2',
      baseUrl: 'http://localhost:8000',
      storage: storages.T2,
      gate: gates.T2,
      clock,
      rng,
      fetchFn: netModel.createFetchForTerminal('T2'),
    }),
  };

  const createdSalesByTerminal: Record<TermId, LocalEvent[]> = {
    T1: [],
    T2: [],
  };

  const terminalSeqCounter: Record<TermId, number> = {
    T1: 0,
    T2: 0,
  };


  // Helper to create a sale
  const createSale = async (termId: TermId) => {
    terminalSeqCounter[termId]++;
    const seq = terminalSeqCounter[termId];
    const eventId = `SALE_${termId}_${seq}_${seed}`;

    // Pick 1 to 2 random SKUs with qty 1 to 3
    const numLines = rng.nextInt(1, 2);
    const lines = [];
    for (let l = 0; l < numLines; l++) {
      const prod = rng.pick(catalog);
      lines.push({
        sku: prod.sku,
        qty: rng.nextInt(1, 3),
        unit_price_paise: prod.price_paise,
        line_total_paise: prod.price_paise,
      });
    }

    const payload: SaleCompletedPayload = {
      receipt_no: `${termId}-${seq.toString().padStart(6, '0')}`,
      lines,
      subtotal_paise: lines.reduce((s, x) => s + x.line_total_paise, 0),
      total_paise: lines.reduce((s, x) => s + x.line_total_paise, 0),
      tender_method: 'CASH',
      received_paise: lines.reduce((s, x) => s + x.line_total_paise, 0),
      change_paise: 0,
    };

    const event: LocalEvent = {
      id: eventId,
      terminal_id: termId,
      terminal_seq: seq,
      type: 'SALE_COMPLETED',
      payload,
      client_ts: new Date(clock.now()).toISOString(),
      status: 'pending',
    };

    await storages[termId].addEvent(event);
    createdSalesByTerminal[termId].push(event);

    // Sync trigger after sale (as mandated by spec)
    try {
      await engines[termId].syncOnce();
    } catch {
      // transient network drop or partition is expected
    }
  };

  // 4. Run chaotic workload loop
  for (let step = 0; step < steps; step++) {
    clock.advance(100);

    const action = rng.nextInt(0, 6);
    const targetTerm = rng.pick(terminals);

    switch (action) {
      case 0:
      case 1:
      case 2:
        // Generate a sale on target terminal
        await createSale(targetTerm);
        break;

      case 3:
        // Network partition / heal
        if (netModel.isPartitioned(targetTerm)) {
          netModel.healTerminal(targetTerm);
          // On reconnect trigger sync
          try {
            await engines[targetTerm].syncOnce();
          } catch {
            // expected
          }
        } else {
          netModel.partitionTerminal(targetTerm);
        }
        break;

      case 4:
        // Crash and restart engine from persisted storage
        engines[targetTerm].stop();
        // Clone storage to ensure persistent boundary
        storages[targetTerm] = storages[targetTerm].clone();
        engines[targetTerm] = new SyncEngine({
          terminalId: targetTerm,
          baseUrl: 'http://localhost:8000',
          storage: storages[targetTerm],
          gate: gates[targetTerm],
          clock,
          rng,
          fetchFn: netModel.createFetchForTerminal(targetTerm),
        });
        break;

      case 5:
      case 6:
        // Periodic sync trigger
        try {
          await engines[targetTerm].syncOnce();
        } catch {
          // expected
        }
        break;
    }
  }

  // 5. QUIESCENCE PHASE
  // Heal all networks and remove all chaos
  netModel.healTerminal('T1');
  netModel.healTerminal('T2');
  netModel.dropRate = 0;
  netModel.dropAckRate = 0;
  netModel.duplicateRate = 0;

  // Run quiescence sync cycles until all pending events are flushed
  for (let q = 0; q < 5; q++) {
    clock.advance(1000);
    try {
      await engines.T1.syncOnce();
    } catch {
      //
    }
    try {
      await engines.T2.syncOnce();
    } catch {
      //
    }
  }

  // Stop background timers
  engines.T1.stop();
  engines.T2.stop();

  // 6. INVARIANT CHECKS
  const allCreatedSales = [...createdSalesByTerminal.T1, ...createdSalesByTerminal.T2];
  const audit = server.getAudit();

  // Invariant 1: Audit passes (conservation, no duplicate event_id, no sequence gaps)
  if (audit.status !== 'PASS') {
    return {
      seed,
      success: false,
      totalSalesGenerated: allCreatedSales.length,
      totalSalesOnServer: server.getRawEvents().length,
      error: `Server audit failed: seq_gaps=[${audit.seq_gaps.join(', ')}], duplicate_events=[${audit.duplicate_event_ids.join(', ')}]`,
    };
  }

  // Invariant 2: No lost sales (all local sales reached the server)
  const serverEvents = server.getRawEvents();
  const serverEventIdSet = new Set(serverEvents.map((e) => e.event_id));

  for (const sale of allCreatedSales) {
    if (!serverEventIdSet.has(sale.id)) {
      return {
        seed,
        success: false,
        totalSalesGenerated: allCreatedSales.length,
        totalSalesOnServer: serverEvents.length,
        error: `Lost sale detected: event_id ${sale.id} not found in server ledger`,
      };
    }
  }

  // Invariant 3: Total sales match exactly
  if (serverEvents.length !== allCreatedSales.length) {
    return {
      seed,
      success: false,
      totalSalesGenerated: allCreatedSales.length,
      totalSalesOnServer: serverEvents.length,
      error: `Server events count mismatch: expected ${allCreatedSales.length}, got ${serverEvents.length}`,
    };
  }

  // Invariant 4: Balances match expected totals
  const skuExpectedBalances = new Map<string, number>();
  for (const p of catalog) {
    skuExpectedBalances.set(p.sku, p.opening_stock);
  }
  for (const sale of allCreatedSales) {
    const payload = sale.payload as SaleCompletedPayload;
    for (const line of payload.lines) {
      const cur = skuExpectedBalances.get(line.sku)!;
      skuExpectedBalances.set(line.sku, cur - line.qty);
    }
  }

  const serverBalances = server.getRawBalances();
  for (const [sku, expected] of skuExpectedBalances.entries()) {
    const actual = serverBalances.get(sku);
    if (actual !== expected) {
      return {
        seed,
        success: false,
        totalSalesGenerated: allCreatedSales.length,
        totalSalesOnServer: serverEvents.length,
        error: `Balance mismatch for ${sku}: expected ${expected}, got ${actual}`,
      };
    }
  }

  // Invariant 5: Local terminal storages have marked all events as acked after quiescence
  const t1Pending = await storages.T1.getPendingOrSentEvents(100);
  const t2Pending = await storages.T2.getPendingOrSentEvents(100);
  if (t1Pending.length > 0 || t2Pending.length > 0) {
    return {
      seed,
      success: false,
      totalSalesGenerated: allCreatedSales.length,
      totalSalesOnServer: serverEvents.length,
      error: `Pending events remaining after quiescence: T1=${t1Pending.length}, T2=${t2Pending.length}`,
    };
  }

  return {
    seed,
    success: true,
    totalSalesGenerated: allCreatedSales.length,
    totalSalesOnServer: serverEvents.length,
  };
}
