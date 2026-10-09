/**
 * Single-writer command queue (ADR 0012).
 *
 * Every local mutation (add item, qty change, remove, pay) runs strictly
 * in order through one promise-chained queue per terminal.
 * This eliminates race conditions during burst barcode scans or fast tapping.
 */

/**
 * A sequential command queue that ensures all enqueued async operations
 * execute strictly one at a time in submission order.
 */
export class CommandQueue {
  /** The tail of the promise chain. */
  private tail: Promise<void> = Promise.resolve();

  /**
   * Enqueue an async operation. It will not start until all previously
   * enqueued operations have completed (or failed).
   *
   * @param fn - The async function to execute.
   * @returns A promise that resolves with the function's return value.
   */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.tail = this.tail.then(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }
}
