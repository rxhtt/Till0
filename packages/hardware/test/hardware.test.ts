import { describe, expect, it } from 'vitest';
import { VirtualThermalPrinter } from '../src/index';

describe('VirtualThermalPrinter', () => {
  it('connects and prints receipt payload to virtual paper buffer', async () => {
    const printer = new VirtualThermalPrinter();
    expect(printer.status).toBe('SIMULATED');
    await printer.connect();
    await printer.printReceipt('RECEIPT #0001\nTOTAL: 100.00');
    expect(printer.getHistory()).toEqual(['RECEIPT #0001\nTOTAL: 100.00']);
  });
});
