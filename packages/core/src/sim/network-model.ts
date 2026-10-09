/**
 * Deterministic Network Model for simulated multi-terminal chaos.
 *
 * Supports:
 * - drop percentage (0 - 100)
 * - duplicate probability
 * - reorder / delay simulation
 * - partition (cuts communication between specific terminal and server)
 */

import type { SeededRng } from './deterministic.js';
import type { InMemoryFakeServer } from './fake-server.js';
import type { PushBatch } from '../types.js';

export interface NetworkModelOptions {
  rng: SeededRng;
  server: InMemoryFakeServer;
  dropRate?: number;
  duplicateRate?: number;
  dropAckRate?: number;
}

export class NetworkModel {
  private rng: SeededRng;
  private server: InMemoryFakeServer;
  private partitions: Set<string> = new Set();
  public dropRate: number;
  public duplicateRate: number;
  public dropAckRate: number;

  constructor(options: NetworkModelOptions) {
    this.rng = options.rng;
    this.server = options.server;
    this.dropRate = options.dropRate ?? 0;
    this.duplicateRate = options.duplicateRate ?? 0;
    this.dropAckRate = options.dropAckRate ?? 0;
  }

  public partitionTerminal(terminalId: string): void {
    this.partitions.add(terminalId);
  }

  public healTerminal(terminalId: string): void {
    this.partitions.delete(terminalId);
  }

  public isPartitioned(terminalId: string): boolean {
    return this.partitions.has(terminalId);
  }

  /**
   * Create a simulated fetch function bound to a specific terminal.
   */
  public createFetchForTerminal(terminalId: string): (url: string, init?: RequestInit) => Promise<Response> {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      // 1. Check network partition
      if (this.partitions.has(terminalId)) {
        throw new TypeError(`Network partition: ${terminalId} disconnected from server`);
      }

      // 2. Drop request before server gets it
      if (this.dropRate > 0 && this.rng.next() < this.dropRate) {
        throw new TypeError(`Simulated network drop: request lost for ${terminalId}`);
      }

      // 3. Duplicate request: if enabled, send request twice to server
      if (this.duplicateRate > 0 && this.rng.next() < this.duplicateRate) {
        try {
          this.dispatchToServer(url, init);
        } catch {
          // ignore duplicate error
        }
      }

      // 4. Process on server
      const responseData = this.dispatchToServer(url, init);

      // 5. Drop ack after server processed request
      if (this.dropAckRate > 0 && this.rng.next() < this.dropAckRate) {
        throw new TypeError(`Simulated network drop: response ack lost for ${terminalId}`);
      }

      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }

  private dispatchToServer(url: string, init?: RequestInit): unknown {
    const parsed = new URL(url, 'http://localhost:8000');
    const pathname = parsed.pathname;

    if (pathname === '/health') {
      return this.server.getHealth();
    }

    if (pathname === '/catalog') {
      return this.getCatalog();
    }

    if (pathname === '/sync/push' && init?.method === 'POST') {
      const batch = JSON.parse((init.body as string) || '{}') as PushBatch;
      return this.server.syncPush(batch);
    }

    if (pathname === '/sync/pull') {
      const since = parseInt(parsed.searchParams.get('since') || '0', 10);
      const terminalId = parsed.searchParams.get('terminal_id') || '';
      return this.server.syncPull(since, terminalId);
    }

    if (pathname === '/audit') {
      return this.server.getAudit();
    }

    throw new Error(`Simulated server 404 for ${url}`);
  }

  private getCatalog(): unknown {
    return this.server.getCatalog();
  }
}
