import * as Peepsy from '../src/index';

describe('Index exports', () => {
  test('exports expected classes and utilities', () => {
    expect(typeof Peepsy.PeepsyMaster).toBe('function');
    expect(typeof Peepsy.PeepsyChild).toBe('function');
    expect(typeof Peepsy.PriorityQueue).toBe('function');
    expect(typeof Peepsy.DefaultLogger).toBe('function');
    expect(typeof Peepsy.NoOpLogger).toBe('function');
    expect(typeof Peepsy.delay).toBe('function');
    expect(typeof Peepsy.generateId).toBe('function');
    expect(typeof Peepsy.isValidTimeout).toBe('function');
    expect(typeof Peepsy.sanitizeError).toBe('function');
    expect(typeof Peepsy.VERSION).toBe('string');
  });
});
