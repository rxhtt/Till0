/**
 * Web browser lock coordinator using navigator.locks.
 *
 * Implements single sync worker per terminal DB (ADR 0007).
 * Secondary tabs yield or stand by while primary tab holds the lock.
 */

import type { LockCoordinator } from '@till0/core';

export class NavigatorLocksCoordinator implements LockCoordinator {
  public async requestLock<T>(name: string, callback: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
      return navigator.locks.request(name, async () => {
        return callback();
      });
    }

    // Fallback in environments without Web Locks (e.g. Node tests without mock)
    return callback();
  }
}

/**
 * BroadcastChannel notifier to communicate sync status to UI and tabs.
 */
import type { SyncNotifier, SyncEngineStatus } from '@till0/core';

export class BroadcastSyncNotifier implements SyncNotifier {
  private channel: BroadcastChannel | null = null;
  private readonly channelName: string;
  private listeners: Set<(status: SyncEngineStatus) => void> = new Set();

  constructor(terminalId: string) {
    this.channelName = `till0_sync_${terminalId}`;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.onmessage = (event) => {
        if (event.data?.type === 'SYNC_STATUS_UPDATE') {
          for (const listener of this.listeners) {
            listener(event.data.status as SyncEngineStatus);
          }
        }
      };
    }
  }

  public notify(status: SyncEngineStatus): void {
    // Notify local listeners
    for (const listener of this.listeners) {
      listener(status);
    }

    // Broadcast to other tabs
    if (this.channel) {
      try {
        this.channel.postMessage({
          type: 'SYNC_STATUS_UPDATE',
          status,
        });
      } catch {
        // channel closed or postMessage error
      }
    }
  }

  public subscribe(callback: (status: SyncEngineStatus) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  public close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.listeners.clear();
  }
}
