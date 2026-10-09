/**
 * Hardware interfaces and driver abstractions for thermal printers and barcode scanners.
 */

/**
 * Printer connection types supported by Till0 hardware layer.
 */
export type PrinterConnectionType = 'SIMULATED' | 'USB' | 'SERIAL' | 'BLUETOOTH' | 'DISCONNECTED';

/**
 * Hardware thermal printer interface.
 */
export interface ThermalPrinter {
  /**
   * Current connection status of the printer device.
   */
  readonly status: PrinterConnectionType;

  /**
   * Connect to the hardware device.
   */
  connect(): Promise<void>;

  /**
   * Print a raw text receipt payload to the thermal printer.
   *
   * @param payload - Formatted receipt text or ESC/POS byte sequence.
   */
  printReceipt(payload: string): Promise<void>;
}

/**
 * Virtual thermal printer implementation for browser environments.
 */
export class VirtualThermalPrinter implements ThermalPrinter {
  public readonly status: PrinterConnectionType = 'SIMULATED';
  private printedBuffer: string[] = [];

  /**
   * Connects virtual printer device.
   */
  public async connect(): Promise<void> {
    // Virtual printer connects immediately
  }

  /**
   * Appends receipt text to in-memory paper buffer.
   *
   * @param payload - Formatted receipt string.
   */
  public async printReceipt(payload: string): Promise<void> {
    this.printedBuffer.push(payload);
  }

  /**
   * Get all captured print operations.
   */
  public getHistory(): readonly string[] {
    return this.printedBuffer;
  }
}
