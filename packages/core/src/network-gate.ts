/**
 * Network Gate implementation for simulating network anomalies and offline status.
 *
 * All network traffic in Till0 (sync engine, health probes, catalog refresh)
 * routes through a NetworkGate.
 *
 * Configurable parameters:
 * - offline: boolean
 * - addedLatencyMs: number (delays every request)
 * - dropAckPercentage: number (0 - 100, drops response after server processes it)
 * - duplicateRequestMode: boolean (sends every request twice)
 */

export interface NetworkGateConfig {
  offline?: boolean;
  addedLatencyMs?: number;
  dropAckPercentage?: number;
  duplicateRequestMode?: boolean;
}

export interface NetworkGateStats {
  requestsTotal: number;
  requestsBlockedOffline: number;
  requestsDuplicated: number;
  acksDropped: number;
}

export type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Gatekeeper for all network traffic with fault injection support.
 */
export class NetworkGate {
  private offline: boolean;
  private addedLatencyMs: number;
  private dropAckPercentage: number;
  private duplicateRequestMode: boolean;
  private stats: NetworkGateStats = {
    requestsTotal: 0,
    requestsBlockedOffline: 0,
    requestsDuplicated: 0,
    acksDropped: 0,
  };

  constructor(config: NetworkGateConfig = {}) {
    this.offline = config.offline ?? false;
    this.addedLatencyMs = config.addedLatencyMs ?? 0;
    this.dropAckPercentage = config.dropAckPercentage ?? 0;
    this.duplicateRequestMode = config.duplicateRequestMode ?? false;
  }

  public setOffline(offline: boolean): void {
    this.offline = offline;
  }

  public isOffline(): boolean {
    return this.offline;
  }

  public setAddedLatency(ms: number): void {
    this.addedLatencyMs = Math.max(0, ms);
  }

  public getAddedLatency(): number {
    return this.addedLatencyMs;
  }

  public setDropAckPercentage(pct: number): void {
    this.dropAckPercentage = Math.min(100, Math.max(0, pct));
  }

  public getDropAckPercentage(): number {
    return this.dropAckPercentage;
  }

  public setDuplicateRequestMode(enabled: boolean): void {
    this.duplicateRequestMode = enabled;
  }

  public isDuplicateRequestMode(): boolean {
    return this.duplicateRequestMode;
  }

  public getStats(): Readonly<NetworkGateStats> {
    return { ...this.stats };
  }

  public resetStats(): void {
    this.stats = {
      requestsTotal: 0,
      requestsBlockedOffline: 0,
      requestsDuplicated: 0,
      acksDropped: 0,
    };
  }

  /**
   * Execute a fetch request through the network gate.
   *
   * @param url - Destination URL string.
   * @param init - Request options.
   * @param underlyingFetch - The real fetch implementation.
   * @param randomFloat - Injected RNG function returning [0, 1) for determinism.
   * @returns Response promise.
   */
  public async fetch(
    url: string,
    init?: RequestInit,
    underlyingFetch: FetchFunction = fetch,
    randomFloat: () => number = Math.random,
  ): Promise<Response> {
    this.stats.requestsTotal++;

    // 1. Check offline status
    if (this.offline) {
      this.stats.requestsBlockedOffline++;
      throw new TypeError('NetworkGate: connection offline');
    }

    // 2. Added latency delay
    if (this.addedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.addedLatencyMs));
      // If went offline during latency sleep
      if (this.offline) {
        this.stats.requestsBlockedOffline++;
        throw new TypeError('NetworkGate: connection offline');
      }
    }

    // 3. Duplicate request mode: fire a clone of the request first
    if (this.duplicateRequestMode) {
      this.stats.requestsDuplicated++;
      // Fire duplicate concurrently (fire-and-forget or awaited)
      try {
        void underlyingFetch(url, init ? structuredCloneInit(init) : undefined);
      } catch {
        // Ignore duplicate failure
      }
    }

    // 4. Send primary request
    const response = await underlyingFetch(url, init);

    // 5. Drop ack percentage: simulate dropped HTTP response after server received & processed request
    if (this.dropAckPercentage > 0) {
      const roll = randomFloat() * 100;
      if (roll < this.dropAckPercentage) {
        this.stats.acksDropped++;
        throw new TypeError('NetworkGate: ack dropped (connection reset)');
      }
    }

    return response;
  }
}

/**
 * Shallow/safe clone of RequestInit for duplicated calls.
 */
function structuredCloneInit(init: RequestInit): RequestInit {
  const clone: RequestInit = { ...init };
  if (init.headers) {
    clone.headers = typeof init.headers === 'object' ? { ...init.headers } : init.headers;
  }
  return clone;
}

