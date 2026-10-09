/**
 * Dexie adapter implementing ISyncStorage for the browser web app.
 */

import type {
  ISyncStorage,
  LocalEvent,
  EventStatus,
  CatalogItem,
} from '@till0/core';
import type { PosDatabase } from './db.js';

export class DexieSyncStorage implements ISyncStorage {
  private db: PosDatabase;

  constructor(db: PosDatabase) {
    this.db = db;
  }

  public async getPendingOrSentEvents(limit = 50): Promise<LocalEvent[]> {
    const list = await this.db.events
      .where('status')
      .anyOf('pending', 'sent')
      .limit(limit)
      .toArray();
    // Sort in memory by terminal_seq
    return list.sort((a, b) => a.terminal_seq - b.terminal_seq);
  }

  public async updateEventStatus(eventIds: string[], status: EventStatus): Promise<void> {
    if (eventIds.length === 0) return;
    await this.db.events
      .where('id')
      .anyOf(eventIds)
      .modify({ status });
  }

  public async getAllEvents(): Promise<LocalEvent[]> {
    return this.db.events.toArray();
  }

  public async addEvent(event: LocalEvent): Promise<void> {
    await this.db.events.put(event);
  }

  public async getMeta(key: string): Promise<string | number | undefined> {
    const row = await this.db.meta.get(key);
    return row?.value;
  }

  public async setMeta(key: string, value: string | number): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  public async updateCatalogBalances(balances: readonly { sku: string; qty: number }[]): Promise<void> {
    await this.db.transaction('rw', this.db.catalog, async () => {
      for (const { sku, qty } of balances) {
        await this.db.catalog
          .where('sku')
          .equals(sku)
          .modify({ qty });
      }
    });
  }

  public async getCatalogItem(sku: string): Promise<CatalogItem | undefined> {
    return this.db.catalog.get(sku);
  }

  public async getAllCatalogItems(): Promise<CatalogItem[]> {
    return this.db.catalog.toArray();
  }

  public async setCatalogItems(items: CatalogItem[]): Promise<void> {
    await this.db.catalog.bulkPut(items);
  }
}
