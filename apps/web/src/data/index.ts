/**
 * Data layer barrel export for apps/web.
 */

export { PosDatabase, getDb, clearDbCache } from './db.js';
export { CommandQueue } from './command-queue.js';
export { appendSale } from './append-sale.js';
export { displayStock, displayStockAll, applyPull } from './projection.js';
