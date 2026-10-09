/**
 * SyncEngine: Offline-first sync manager for Till0 POS terminal.
 *
 * Requirements:
 * - All fetches go through one NetworkGate
 * - Connection liveness via GET /health heartbeat (not navigator.onLine)
 * - Batch up to 50 events in /sync/push
 * - Exponential backoff 0.5s to 30s with jitter
 * - Sync triggers:
 *     1. after each sale (push immediately)
 *     2. on reconnect (health transition offline -> online)
 *     3. periodic interval (every 5s)
 * - Concurrency control:
 *     - Only one sync worker per terminal DB via lock coordinator
 * - State notification:
 *     - Broadcast updates to UI via SyncNotifier
 */

import type { TerminalId, PushBatch, PushResponse, PullResponse } from './types.js';
import type { Clock, Rng } from './clock.js';
import { SystemClock, SystemRng } from './clock.js';
import type { NetworkGate } from './network-gate.js';
import type { ISyncStorage } from './sync-storage.js';

export interface SyncEngineStatus {
  online: boolean;
  syncing: boolean;
  queuedCount: number;
  lastCommitMs: number | null;
  lastSyncTime: number | null;
  consecutiveFailures: number;
}

export interface SyncNotifier {
  notify(status: SyncEngineStatus): void;
}

export interface LockCoordinator {
  requestLock<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface SyncEngineOptions {
  terminalId: TerminalId;
  baseUrl: string;
  storage: ISyncStorage;
  gate: NetworkGate;
  notifier?: SyncNotifier | undefined;
  lockCoordinator?: LockCoordinator | undefined;
  clock?: Clock | undefined;
  rng?: Rng | undefined;
  batchSize?: number | undefined;
  minBackoffMs?: number | undefined;
  maxBackoffMs?: number | undefined;
  heartbeatIntervalMs?: number | undefined;
  periodicSyncIntervalMs?: number | undefined;
  // Custom fetch function for simulator or node environment
  fetchFn?: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;
}

export class SyncEngine {
  public readonly terminalId: TerminalId;
  private readonly baseUrl: string;
  private readonly storage: ISyncStorage;
  private readonly gate: NetworkGate;
  private readonly notifier: SyncNotifier | undefined;
  private readonly lockCoordinator: LockCoordinator | undefined;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly batchSize: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly periodicSyncIntervalMs: number;
  private readonly fetchFn: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;

  private isOnline = false;
  private isSyncing = false;
  private consecutiveFailures = 0;
  private lastCommitMs: number | null = null;
  private lastSyncTime: number | null = null;
  private isDestroyed = false;

  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SyncEngineOptions) {
    this.terminalId = options.terminalId;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.storage = options.storage;
    this.gate = options.gate;
    this.notifier = options.notifier;
    this.lockCoordinator = options.lockCoordinator;
    this.clock = options.clock ?? SystemClock;
    this.rng = options.rng ?? SystemRng;
    this.batchSize = options.batchSize ?? 50;
    this.minBackoffMs = options.minBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 30000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5000;
    this.periodicSyncIntervalMs = options.periodicSyncIntervalMs ?? 5000;
    this.fetchFn = options.fetchFn;
  }


  /**
   * Start background heartbeats and periodic sync loop.
   */
  public async start(): Promise<void> {
    this.isDestroyed = false;
    // Initial health check
    await this.checkHealth();
    this.scheduleHeartbeat();
    this.schedulePeriodicSync();
  }

  /**
   * Stop background loops and timers.
   */
  public stop(): void {
    this.isDestroyed = true;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.periodicTimer) clearTimeout(this.periodicTimer);
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    this.heartbeatTimer = null;
    this.periodicTimer = null;
    this.backoffTimer = null;
  }

  public getStatus(): SyncEngineStatus {
    return {
      online: this.isOnline,
      syncing: this.isSyncing,
      queuedCount: 0, // Computed on demand or cached
      lastCommitMs: this.lastCommitMs,
      lastSyncTime: this.lastSyncTime,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  public async getQueuedCount(): Promise<number> {
    const pending = await this.storage.getPendingOrSentEvents(1000);
    return pending.length;
  }

  /**
   * Trigger sync immediately (e.g. after a sale).
   */
  public async triggerSync(): Promise<void> {
    if (this.isDestroyed) return;
    return this.executeSyncWithLock();
  }

  /**
   * Trigger health check immediately (e.g. on navigator online event or manual probe).
   */
  public async checkHealth(): Promise<boolean> {
    if (this.isDestroyed) return false;
    const prevOnline = this.isOnline;
    try {
      const res = await this.gate.fetch(
        `${this.baseUrl}/health`,
        { method: 'GET' },
        this.fetchFn,
        () => this.rng.next(),
      );

      if (res.ok) {
        this.isOnline = true;
        if (!prevOnline) {
          // Reconnect transition: immediately reset backoff and trigger sync
          this.consecutiveFailures = 0;
          void this.triggerSync();
        }
      } else {
        this.isOnline = false;
      }
    } catch {
      this.isOnline = false;
    }

    await this.broadcastStatus();
    return this.isOnline;
  }

  /**
   * Execute a single sync cycle (push pending events, pull remote updates).
   */
  public async syncOnce(): Promise<void> {
    if (this.isDestroyed) return;
    return this.executeSyncWithLock();
  }

  private async executeSyncWithLock(): Promise<void> {
    if (this.lockCoordinator) {
      const lockName = `till0_sync_worker_${this.terminalId}`;
      await this.lockCoordinator.requestLock(lockName, async () => {
        await this.runSyncCycle();
      });
    } else {
      await this.runSyncCycle();
    }
  }

  private async runSyncCycle(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    await this.broadcastStatus();

    const startTime = this.clock.now();

    try {
      // 1. PUSH OUTBOX
      await this.pushPendingEvents();

      // 2. PULL REMOTE
      await this.pullRemoteEvents();

      // Success: reset backoff and record metrics
      this.consecutiveFailures = 0;
      this.isOnline = true;
      const duration = this.clock.now() - startTime;
      this.lastCommitMs = duration;
      this.lastSyncTime = this.clock.now();
    } catch {
      this.consecutiveFailures++;
      this.scheduleBackoffRetry();
    } finally {
      this.isSyncing = false;
      await this.broadcastStatus();
    }
  }

  private async pushPendingEvents(): Promise<void> {
    // Read pending / sent events up to batchSize
    const pendingEvents = await this.storage.getPendingOrSentEvents(this.batchSize);
    if (pendingEvents.length === 0) {
      return;
    }

    // Mark events as 'sent' in storage before firing network request (outbox state)
    const eventIds = pendingEvents.map((e) => e.id);
    await this.storage.updateEventStatus(eventIds, 'sent');

    const pushBatch: PushBatch = {
      events: pendingEvents.map((e) => ({
        event_id: e.id,
        terminal_id: e.terminal_id,
        terminal_seq: e.terminal_seq,
        type: e.type,
        payload: e.payload as Record<string, unknown>,
        client_ts: e.client_ts,
      })),
    };

    const res = await this.gate.fetch(
      `${this.baseUrl}/sync/push`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pushBatch),
      },
      this.fetchFn,
      () => this.rng.next(),
    );

    if (!res.ok) {
      throw new Error(`Push failed with HTTP ${res.status}`);
    }

    const data = (await res.json()) as PushResponse;
    const appliedOrDuplicateIds: string[] = [];

    for (const item of data.results) {
      if (item.status === 'applied' || item.status === 'duplicate') {
        appliedOrDuplicateIds.push(item.event_id);
      }
    }

    // Mark applied / duplicate events as 'acked'
    if (appliedOrDuplicateIds.length > 0) {
      await this.storage.updateEventStatus(appliedOrDuplicateIds, 'acked');
    }

    // If there are more pending events, continue pushing in next batch
    const remaining = await this.storage.getPendingOrSentEvents(1);
    if (remaining.length > 0) {
      await this.pushPendingEvents();
    }
  }

  private async pullRemoteEvents(): Promise<void> {
    const rawCursor = await this.storage.getMeta('cursor');
    const since = typeof rawCursor === 'number' ? rawCursor : 0;

    const url = `${this.baseUrl}/sync/pull?since=${since}&terminal_id=${encodeURIComponent(this.terminalId)}`;
    const res = await this.gate.fetch(
      url,
      { method: 'GET' },
      this.fetchFn,
      () => this.rng.next(),
    );

    if (!res.ok) {
      throw new Error(`Pull failed with HTTP ${res.status}`);
    }

    const data = (await res.json()) as PullResponse;

    // 1. Update balances
    if (data.balances && data.balances.length > 0) {
      await this.storage.updateCatalogBalances(data.balances);
    }

    // 2. Mark own_applied_ids as acked
    if (data.own_applied_ids && data.own_applied_ids.length > 0) {
      await this.storage.updateEventStatus(data.own_applied_ids, 'acked');
    }

    // 3. Update cursor
    if (data.as_of_server_seq !== undefined) {
      await this.storage.setMeta('cursor', data.as_of_server_seq);
      await this.storage.setMeta('as_of', new Date(this.clock.now()).toISOString());
    }
  }

  /**
   * Calculate exponential backoff duration with jitter:
   * duration = min(maxBackoff, minBackoff * 2^(failures - 1)) * (0.8 + 0.4 * rng)
   */
  public computeBackoffMs(failures: number): number {
    if (failures <= 0) return 0;
    const exp = Math.min(6, failures - 1); // cap 2^6 = 64
    const base = Math.min(this.maxBackoffMs, this.minBackoffMs * Math.pow(2, exp));
    // Jitter: ±20%
    const jitter = 0.8 + 0.4 * this.rng.next();
    return Math.floor(base * jitter);
  }

  private scheduleBackoffRetry(): void {
    if (this.isDestroyed) return;
    if (this.backoffTimer) clearTimeout(this.backoffTimer);

    const backoffMs = this.computeBackoffMs(this.consecutiveFailures);
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      void this.executeSyncWithLock();
    }, backoffMs);
  }

  private scheduleHeartbeat(): void {
    if (this.isDestroyed) return;
    this.heartbeatTimer = setTimeout(async () => {
      if (this.isDestroyed) return;
      await this.checkHealth();
      this.scheduleHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private schedulePeriodicSync(): void {
    if (this.isDestroyed) return;
    this.periodicTimer = setTimeout(async () => {
      if (this.isDestroyed) return;
      if (this.isOnline) {
        await this.executeSyncWithLock();
      }
      this.schedulePeriodicSync();
    }, this.periodicSyncIntervalMs);
  }

  private async broadcastStatus(): Promise<void> {
    if (this.notifier) {
      const queuedCount = await this.getQueuedCount();
      this.notifier.notify({
        online: this.isOnline,
        syncing: this.isSyncing,
        queuedCount,
        lastCommitMs: this.lastCommitMs,
        lastSyncTime: this.lastSyncTime,
        consecutiveFailures: this.consecutiveFailures,
      });
    }
  }
}
