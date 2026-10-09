/**
 * Tests for NetworkGate, SyncEngine, and Simulator.
 *
 * Requirements:
 * - Property tests with fast-check
 * - Burst of 25 local sales during active sync loses nothing
 * - Two tabs on one terminal produce one sync worker (via NavigatorLocksCoordinator / lock mock)
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  NetworkGate,
  SyncEngine,
  MemorySyncStorage,
  InMemoryFakeServer,
  runSimulation,
  VirtualClock,
  SeededRng,
  type LocalEvent,
  type SaleCompletedPayload,
} from '../src/index.js';

describe('NetworkGate fault injection', () => {
  it('throws TypeError when offline', async () => {
    const gate = new NetworkGate({ offline: true });
    const mockFetch = vi.fn();
    await expect(gate.fetch('http://localhost:8000/health', {}, mockFetch)).rejects.toThrow(
      'NetworkGate: connection offline',
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(gate.getStats().requestsBlockedOffline).toBe(1);
  });

  it('drops ack with configured percentage', async () => {
    const gate = new NetworkGate({ dropAckPercentage: 100 });
    const mockFetch = vi.fn().mockResolvedValue(new Response('{"status":"ok"}'));
    await expect(
      gate.fetch('http://localhost:8000/health', {}, mockFetch, () => 0.5),
    ).rejects.toThrow('NetworkGate: ack dropped');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(gate.getStats().acksDropped).toBe(1);
  });

  it('duplicates request when duplicateRequestMode is enabled', async () => {
    const gate = new NetworkGate({ duplicateRequestMode: true });
    const mockFetch = vi.fn().mockResolvedValue(new Response('{"status":"ok"}'));
    await gate.fetch('http://localhost:8000/health', {}, mockFetch);
    // Both duplicate and primary dispatched
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(gate.getStats().requestsDuplicated).toBe(1);
  });
});

describe('SyncEngine Backoff with Jitter', () => {
  it('computes exponential backoff within bounds [0.5s, 30s]', () => {
    const clock = new VirtualClock();
    const rng = new SeededRng(12345);
    const gate = new NetworkGate();
    const storage = new MemorySyncStorage();
    const engine = new SyncEngine({
      terminalId: 'T1',
      baseUrl: 'http://localhost:8000',
      storage,
      gate,
      clock,
      rng,
      minBackoffMs: 500,
      maxBackoffMs: 30000,
    });

    // 0 failures -> 0 ms
    expect(engine.computeBackoffMs(0)).toBe(0);

    // Failures 1 through 10
    for (let f = 1; f <= 10; f++) {
      const b = engine.computeBackoffMs(f);
      expect(b).toBeGreaterThanOrEqual(400); // 500 * 0.8
      expect(b).toBeLessThanOrEqual(36000);  // 30000 * 1.2
    }
  });
});

describe('Concurrency and Locks', () => {
  it('two tabs on one terminal produce one active sync worker via lock coordinator', async () => {
    let activeWorkers = 0;
    let peakConcurrency = 0;

    // Simulate navigator.locks exclusive lock queue
    let lockQueue = Promise.resolve();
    const lockCoordinator = {
      async requestLock<T>(_name: string, callback: () => Promise<T>): Promise<T> {
        const next = lockQueue.then(async () => {
          activeWorkers++;
          if (activeWorkers > peakConcurrency) peakConcurrency = activeWorkers;
          try {
            return await callback();
          } finally {
            activeWorkers--;
          }
        });
        lockQueue = next.then(() => {}, () => {});
        return next;
      },
    };


    const server = new InMemoryFakeServer([
      { sku: 'SKU1', name: 'Item', price_paise: 100, tax_bp: 0, barcode: '8901234000010', opening_stock: 100 },
    ]);
    const storage = new MemorySyncStorage();
    const gate = new NetworkGate();

    const fetchFn = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === '/sync/push') {
        const body = JSON.parse(init?.body as string);
        return new Response(JSON.stringify(server.syncPush(body)));
      }
      if (u.pathname === '/sync/pull') {
        return new Response(JSON.stringify(server.syncPull()));
      }
      return new Response('{"status":"ok"}');
    };

    const tab1 = new SyncEngine({
      terminalId: 'T1',
      baseUrl: 'http://localhost:8000',
      storage,
      gate,
      lockCoordinator,
      fetchFn,
    });

    const tab2 = new SyncEngine({
      terminalId: 'T1',
      baseUrl: 'http://localhost:8000',
      storage,
      gate,
      lockCoordinator,
      fetchFn,
    });

    // Run both tabs simultaneously
    await Promise.all([tab1.syncOnce(), tab2.syncOnce()]);

    expect(peakConcurrency).toBe(1);
    expect(activeWorkers).toBe(0);
  });

  it('a 25-event burst of local sales during an active sync loses nothing', async () => {
    const catalogItem = {
      sku: 'SKU1',
      name: 'Item',
      price_paise: 100,
      tax_bp: 0,
      barcode: '8901234000010',
      opening_stock: 500,
      qty: 500,
    };
    const server = new InMemoryFakeServer([catalogItem]);
    const storage = new MemorySyncStorage([catalogItem]);
    const gate = new NetworkGate();

    const fetchFn = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === '/sync/push') {
        // Artificially delay push to create an in-flight window
        await new Promise((r) => setTimeout(r, 20));
        const body = JSON.parse(init?.body as string);
        return new Response(JSON.stringify(server.syncPush(body)));
      }
      if (u.pathname === '/sync/pull') {
        return new Response(JSON.stringify(server.syncPull(0, 'T1')));
      }
      return new Response('{"status":"ok"}');
    };

    const engine = new SyncEngine({
      terminalId: 'T1',
      baseUrl: 'http://localhost:8000',
      storage,
      gate,
      fetchFn,
    });

    // 1. Initial sale to trigger sync
    const initialSale: LocalEvent = {
      id: 'SALE_0',
      terminal_id: 'T1',
      terminal_seq: 1,
      type: 'SALE_COMPLETED',
      payload: {
        receipt_no: 'T1-000001',
        lines: [{ sku: 'SKU1', qty: 1, unit_price_paise: 100, line_total_paise: 100 }],
        subtotal_paise: 100,
        total_paise: 100,
        tender_method: 'CASH',
        received_paise: 100,
        change_paise: 0,
      } as SaleCompletedPayload,
      client_ts: new Date().toISOString(),
      status: 'pending',
    };
    await storage.addEvent(initialSale);

    // 2. Start sync
    const syncPromise = engine.syncOnce();

    // 3. Concurrently burst 25 sales into storage while sync is active
    for (let i = 1; i <= 25; i++) {
      const burstSale: LocalEvent = {
        id: `BURST_SALE_${i}`,
        terminal_id: 'T1',
        terminal_seq: i + 1,
        type: 'SALE_COMPLETED',
        payload: {
          receipt_no: `T1-${(i + 1).toString().padStart(6, '0')}`,
          lines: [{ sku: 'SKU1', qty: 1, unit_price_paise: 100, line_total_paise: 100 }],
          subtotal_paise: 100,
          total_paise: 100,
          tender_method: 'CASH',
          received_paise: 100,
          change_paise: 0,
        } as SaleCompletedPayload,
        client_ts: new Date().toISOString(),
        status: 'pending',
      };
      await storage.addEvent(burstSale);
    }

    await syncPromise;

    // Follow-up sync to flush any remaining pending events
    await engine.syncOnce();

    // Invariant: All 26 sales (initial + 25 burst) exist on server
    const serverEvents = server.getRawEvents();
    expect(serverEvents).toHaveLength(26);

    const pending = await storage.getPendingOrSentEvents(100);
    expect(pending).toHaveLength(0);

    const audit = server.getAudit();
    expect(audit.status).toBe('PASS');
    expect(server.getRawBalances().get('SKU1')).toBe(500 - 26);
  });
});

describe('Property tests with fast-check', () => {
  it('deterministic simulator passes random seed batches', async () => {
    // Run 20 arbitrary seeds with fast-check
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10000 }), async (seed) => {
        const result = await runSimulation(seed, { steps: 30 });
        return result.success;
      }),
      { numRuns: 20 },
    );
  });
});
