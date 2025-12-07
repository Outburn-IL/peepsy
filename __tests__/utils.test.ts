/**
 * Tests for utility functions and classes
 */

import {
  PriorityQueue,
  DefaultLogger,
  NoOpLogger,
  delay,
  generateId,
  isValidTimeout,
  sanitizeError,
} from '../src/utils';

describe('PriorityQueue', () => {
  let queue: PriorityQueue<string>;

  beforeEach(() => {
    queue = new PriorityQueue<string>();
  });

  it('should enqueue and dequeue items', () => {
    queue.enqueue('item1', 0, 5000);
    queue.enqueue('item2', 1, 5000);

    expect(queue.size()).toBe(2);
    expect(queue.isEmpty()).toBe(false);

    const item1 = queue.dequeue();
    expect(item1).toBe('item1'); // Lower priority number = higher priority

    const item2 = queue.dequeue();
    expect(item2).toBe('item2');

    expect(queue.isEmpty()).toBe(true);
  });

  it('should respect priority ordering', () => {
    queue.enqueue('low', 10, 5000);
    queue.enqueue('high', 1, 5000);
    queue.enqueue('medium', 5, 5000);

    expect(queue.dequeue()).toBe('high');
    expect(queue.dequeue()).toBe('medium');
    expect(queue.dequeue()).toBe('low');
  });

  it('should handle expired items', () => {
    queue.enqueue('expired', 0, 1); // 1ms timeout
    queue.enqueue('valid', 0, 5000);

    // Wait for expiration
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(queue.dequeue()).toBe('valid');
        expect(queue.dequeue()).toBe(null);
        resolve();
      }, 10);
    });
  });

  it('should clean expired messages', () => {
    queue.enqueue('expired1', 0, 1);
    queue.enqueue('expired2', 0, 1);
    queue.enqueue('valid', 0, 5000);

    return new Promise<void>(resolve => {
      setTimeout(() => {
        const cleaned = queue.cleanExpiredMessages();
        expect(cleaned).toBe(2);
        expect(queue.size()).toBe(1);
        resolve();
      }, 10);
    });
  });

  it('should peek at next item without removing it', () => {
    queue.enqueue('first', 0, 5000);
    queue.enqueue('second', 1, 5000);

    expect(queue.peek()).toBe('first');
    expect(queue.size()).toBe(2); // Should not remove the item

    expect(queue.dequeue()).toBe('first');
    expect(queue.peek()).toBe('second');
  });

  it('should clear all items', () => {
    queue.enqueue('item1', 0, 5000);
    queue.enqueue('item2', 1, 5000);

    queue.clear();

    expect(queue.isEmpty()).toBe(true);
    expect(queue.size()).toBe(0);
  });
});

describe('DefaultLogger', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('should log messages with proper formatting', () => {
    const logger = new DefaultLogger('info');

    logger.info('Test message', { data: 'test' });

    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[INFO] [Peepsy] Test message {"data":"test"}')
    );
  });

  it('should respect log level filtering', () => {
    const logger = new DefaultLogger('warn');

    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');
    logger.error('Error message');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('should format messages with multiple arguments', () => {
    const logger = new DefaultLogger('debug');

    logger.debug('Message', 'arg1', 42, { key: 'value' });

    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('Message arg1 42 {"key":"value"}')
    );
  });
});

describe('NoOpLogger', () => {
  it('should not log anything', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const logger = new NoOpLogger();

    logger.debug();
    logger.info();
    logger.warn();
    logger.error();

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('Utility Functions', () => {
  describe('delay', () => {
    it('should delay execution', async () => {
      const start = Date.now();
      await delay(100);
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(90); // Allow some tolerance
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
    });

    it('should generate IDs with timestamp prefix', () => {
      const id = generateId();
      const timestamp = id.split('-')[0];

      expect(Number(timestamp)).toBeCloseTo(Date.now(), -2); // Within 100ms
    });
  });

  describe('isValidTimeout', () => {
    it('should validate timeout values', () => {
      expect(isValidTimeout(1000)).toBe(true);
      expect(isValidTimeout(300000)).toBe(true);
      expect(isValidTimeout(1)).toBe(true);

      expect(isValidTimeout(0)).toBe(false);
      expect(isValidTimeout(-1)).toBe(false);
      expect(isValidTimeout(400000)).toBe(false);
      expect(isValidTimeout(1.5)).toBe(false);
    });
  });

  describe('sanitizeError', () => {
    it('should sanitize Error objects', () => {
      const error = new Error('Test error');
      error.stack = 'Error stack trace';

      const sanitized = sanitizeError(error);

      expect(sanitized.message).toBe('Test error');
      expect(sanitized.stack).toBe('Error stack trace');
    });

    it('should sanitize Error objects without stack', () => {
      const error = new Error('Test error');
      delete error.stack;

      const sanitized = sanitizeError(error);

      expect(sanitized.message).toBe('Test error');
      expect(sanitized).not.toHaveProperty('stack');
    });

    it('should sanitize string errors', () => {
      const sanitized = sanitizeError('String error');

      expect(sanitized.message).toBe('String error');
      expect(sanitized).not.toHaveProperty('stack');
    });

    it('should sanitize unknown errors', () => {
      const sanitized = sanitizeError(null);

      expect(sanitized.message).toBe('Unknown error occurred');
      expect(sanitized).not.toHaveProperty('stack');
    });

    it('should sanitize object errors', () => {
      const sanitized = sanitizeError({ code: 'ERR_TEST' });

      expect(sanitized.message).toBe('Unknown error occurred');
      expect(sanitized).not.toHaveProperty('stack');
    });
  });
});
