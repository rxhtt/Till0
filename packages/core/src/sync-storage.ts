/**
 * Pure memory storage for POS terminal events and metadata,
 * providing the exact same data interface needed by SyncEngine
 * both in node simulation and in Dexie IndexedDB.
 */

import type { LocalEvent, EventStatus, CatalogItem } from './types.js';

export interface ISyncStorage {
  // Events
  getPendingOrSentEvents(limit?: number): Promise<LocalEvent[]>;
  updateEventStatus(eventIds: string[], status: EventStatus): Promise<void>;
  getAllEvents(): Promise<LocalEvent[]>;
  addEvent(event: LocalEvent): Promise<void>;

  // Meta
  getMeta(key: string): Promise<string | number | undefined>;
  setMeta(key: string, value: string | number): Promise<void>;

  // Catalog balances
  updateCatalogBalances(balances: readonly { sku: string; qty: number }[]): Promise<void>;
  getCatalogItem(sku: string): Promise<CatalogItem | undefined>;
  getAllCatalogItems(): Promise<CatalogItem[]>;
  setCatalogItems(items: CatalogItem[]): Promise<void>;
}

export class MemorySyncStorage implements ISyncStorage {
  private events: Map<string, LocalEvent> = new Map();
  private meta: Map<string, string | number> = new Map();
  private catalog: Map<string, CatalogItem> = new Map();

  constructor(initialCatalog: CatalogItem[] = []) {
    for (const item of initialCatalog) {
      this.catalog.set(item.sku, { ...item });
    }
  }

  public async getPendingOrSentEvents(limit = 50): Promise<LocalEvent[]> {
    const res: LocalEvent[] = [];
    // Sort by terminal_seq to preserve order
    const sorted = Array.from(this.events.values()).sort((a, b) => a.terminal_seq - b.terminal_seq);
    for (const ev of sorted) {
      if (ev.status === 'pending' || ev.status === 'sent') {
        res.push({ ...ev });
        if (res.length >= limit) break;
      }
    }
    return res;
  }

  public async updateEventStatus(eventIds: string[], status: EventStatus): Promise<void> {
    const idSet = new Set(eventIds);
    for (const [id, ev] of this.events.entries()) {
      if (idSet.has(id)) {
        ev.status = status;
      }
    }
  }

  public async getAllEvents(): Promise<LocalEvent[]> {
    return Array.from(this.events.values()).map((e) => ({ ...e }));
  }

  public async addEvent(event: LocalEvent): Promise<void> {
    this.events.set(event.id, { ...event });
  }

  public async getMeta(key: string): Promise<string | number | undefined> {
    return this.meta.get(key);
  }

  public async setMeta(key: string, value: string | number): Promise<void> {
    this.meta.set(key, value);
  }

  public async updateCatalogBalances(balances: readonly { sku: string; qty: number }[]): Promise<void> {
    for (const b of balances) {
      const item = this.catalog.get(b.sku);
      if (item) {
        this.catalog.set(b.sku, { ...item, qty: b.qty });
      }
    }
  }

  public async getCatalogItem(sku: string): Promise<CatalogItem | undefined> {
    const item = this.catalog.get(sku);
    return item ? { ...item } : undefined;
  }

  public async getAllCatalogItems(): Promise<CatalogItem[]> {
    return Array.from(this.catalog.values()).map((i) => ({ ...i }));
  }

  public async setCatalogItems(items: CatalogItem[]): Promise<void> {
    for (const item of items) {
      this.catalog.set(item.sku, { ...item });
    }
  }

  /**
   * Clone storage state for crash / restart simulation.
   */
  public clone(): MemorySyncStorage {
    const s = new MemorySyncStorage();
    for (const [k, v] of this.events.entries()) {
      s.events.set(k, { ...v });
    }
    for (const [k, v] of this.meta.entries()) {
      s.meta.set(k, v);
    }
    for (const [k, v] of this.catalog.entries()) {
      s.catalog.set(k, { ...v });
    }
    return s;
  }
}
