/**
 * Simple extended tests for PeepsyChild class to increase coverage
 */

import { PeepsyChild } from '../src/index';

// Mock process object for testing
const mockProcess = {
  send: jest.fn(),
  on: jest.fn(),
  removeAllListeners: jest.fn(),
  exit: jest.fn(),
  disconnect: jest.fn(),
  pid: 12345,
};

// Store original process object
const originalProcess = global.process;

describe('PeepsyChild Coverage Tests', () => {
  beforeEach(() => {
    // Mock process methods
    global.process = {
      ...originalProcess,
      send: mockProcess.send,
      on: mockProcess.on,
      removeAllListeners: mockProcess.removeAllListeners,
      exit: mockProcess.exit,
      disconnect: mockProcess.disconnect,
      pid: mockProcess.pid,
    } as any;
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original process
    global.process = originalProcess;
  });

  describe('Constructor Edge Cases', () => {
    it('should create concurrent child with maxConcurrency', () => {
      const child = new PeepsyChild('concurrent', { maxConcurrency: 3 });
      expect(child.getMode()).toBe('concurrent');
      expect(child.getQueueSize()).toBe(0);
    });

    it('should throw error with invalid timeout bounds', () => {
      expect(() => new PeepsyChild('sequential', { timeout: 0 })).toThrow(
        'Invalid timeout value. Must be a positive integer <= 300000ms'
      );
      expect(() => new PeepsyChild('sequential', { timeout: 300001 })).toThrow(
        'Invalid timeout value. Must be a positive integer <= 300000ms'
      );
    });

    it('should throw error without IPC channel', () => {
      global.process = { ...originalProcess, send: undefined } as any;
      expect(() => new PeepsyChild('sequential')).toThrow(
        'This Node.js script was not spawned with an IPC channel'
      );
    });
  });

  describe('Message Handling Coverage', () => {
    let child: PeepsyChild;
    let messageHandler: (message: any) => void;

    beforeEach(() => {
      child = new PeepsyChild('sequential');
      // Capture the message handler
      const onCalls = mockProcess.on.mock.calls.find(call => call[0] === 'message');
      messageHandler = onCalls?.[1];
    });

    it('should handle INIT message', () => {
      const initMessage = { type: 'INIT', mode: 'sequential' };
      expect(() => messageHandler(initMessage)).not.toThrow();
    });

    it('should handle REQUEST message with nested structure', () => {
      child.registerHandler('test', (data: any) => ({ result: data }));
      const requestMessage = {
        type: 'REQUEST',
        request: { id: 'req-1', action: 'test', data: { value: 42 } },
        timeout: 5000,
      };

      expect(() => messageHandler(requestMessage)).not.toThrow();
    });

    it('should handle flat REQUEST message (backward compatibility)', () => {
      child.registerHandler('test', (data: any) => ({ result: data }));
      const requestMessage = {
        type: 'REQUEST',
        id: 'req-2',
        action: 'test',
        data: { value: 42 },
      };

      expect(() => messageHandler(requestMessage)).not.toThrow();
    });

    it('should handle RESPONSE message with active request', () => {
      const responseMessage = {
        type: 'RESPONSE',
        id: 'response-1',
        data: { result: 'success' },
      };

      // Add an active request to respond to
      const mockResolve = jest.fn();
      (child as any).activeRequests.set('response-1', mockResolve);

      messageHandler(responseMessage);
      expect(mockResolve).toHaveBeenCalledWith(responseMessage);
      expect((child as any).activeRequests.has('response-1')).toBe(false);
    });

    it('should handle SHUTDOWN message', () => {
      const shutdownMessage = { type: 'SHUTDOWN' };
      expect(() => messageHandler(shutdownMessage)).not.toThrow();
    });

    it('should ignore messages during shutdown', () => {
      (child as any).isShuttingDown = true;
      const requestMessage = {
        type: 'REQUEST',
        id: 'req-ignore',
        action: 'test',
        data: {},
      };

      expect(() => messageHandler(requestMessage)).not.toThrow();
    });

    it('should handle malformed messages gracefully', () => {
      const malformedMessage = { invalid: 'message' };
      expect(() => messageHandler(malformedMessage)).not.toThrow();
    });

    it('should handle null messages gracefully', () => {
      expect(() => messageHandler(null)).not.toThrow();
    });
  });

  describe('Process Signal Handlers Coverage', () => {
    beforeEach(() => {
      new PeepsyChild('sequential');
    });

    it('should setup all required signal handlers', () => {
      const expectedHandlers = [
        'message',
        'SIGINT',
        'SIGTERM',
        'disconnect',
        'uncaughtException',
        'unhandledRejection',
      ];

      expectedHandlers.forEach(signal => {
        const handlerCall = mockProcess.on.mock.calls.find(call => call[0] === signal);
        expect(handlerCall).toBeDefined();
        expect(typeof handlerCall?.[1]).toBe('function');
      });
    });

    it('should handle uncaughtException', () => {
      const uncaughtCall = mockProcess.on.mock.calls.find(call => call[0] === 'uncaughtException');
      const handler = uncaughtCall?.[1];
      const testError = new Error('Test uncaught exception');
      expect(() => handler(testError)).not.toThrow();
    });

    it('should handle unhandledRejection', () => {
      const unhandledCall = mockProcess.on.mock.calls.find(
        call => call[0] === 'unhandledRejection'
      );
      const handler = unhandledCall?.[1];
      const testReason = 'Test rejection';
      expect(() => handler(testReason)).not.toThrow();
    });
  });

  describe('Heartbeat Coverage', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should send heartbeat messages', () => {
      new PeepsyChild('sequential', { heartbeatIntervalMs: 1000 });

      jest.advanceTimersByTime(1000);

      expect(mockProcess.send).toHaveBeenCalledWith({
        type: 'HEARTBEAT',
        pid: 12345,
        timestamp: expect.any(Number),
        requestsActive: 0,
      });
    });

    it('should handle heartbeat send errors gracefully', () => {
      mockProcess.send.mockImplementation(() => {
        throw new Error('Send failed');
      });

      new PeepsyChild('sequential', { heartbeatIntervalMs: 1000 });

      expect(() => {
        jest.advanceTimersByTime(1000);
      }).not.toThrow();
    });
  });

  describe('Request Processing Coverage', () => {
    let child: PeepsyChild;

    beforeEach(() => {
      child = new PeepsyChild('sequential');
    });

    it('should handle processRequest without IPC channel', async () => {
      global.process = { ...global.process, send: undefined } as any;

      const request = { id: 'test', action: 'nonexistent', data: {} };
      await expect((child as any).processRequest(request)).resolves.toBeUndefined();
    });

    it('should reject request during shutdown', async () => {
      (child as any).isShuttingDown = true;
      await expect(child.sendRequest('test', {})).rejects.toThrow(
        'Cannot send request during shutdown'
      );
    });

    it('should reject request with invalid timeout', async () => {
      await expect(child.sendRequest('test', {}, { timeout: -1 })).rejects.toThrow(
        'Invalid timeout value'
      );
    });

    it('should handle executeRequest without IPC channel', async () => {
      global.process = { ...global.process, send: undefined } as any;

      await expect((child as any).executeRequest('test', {}, 1000)).rejects.toThrow(
        'No IPC channel available'
      );
    });

    it('should handle executeRequest send error', async () => {
      mockProcess.send.mockImplementation(() => {
        throw new Error('Send failed');
      });

      await expect((child as any).executeRequest('test', {}, 1000)).rejects.toThrow('Send failed');
    });
  });

  describe('Queue Management Coverage', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should handle queue cleanup for expired messages', () => {
      const child = new PeepsyChild('sequential');
      const queue = (child as any).queue;

      if (queue) {
        // Add test messages that will expire
        queue.enqueue({ id: '1', action: 'test', data: {} }, 0, 100);
        queue.enqueue({ id: '2', action: 'test', data: {} }, 0, 100);

        expect(queue.size()).toBe(2);

        // Fast-forward past expiration and trigger cleanup
        jest.advanceTimersByTime(5000);

        // Messages should be cleaned up
        expect(queue.size()).toBe(0);
      }
    });

    it('should not process queue when already processing', async () => {
      const child = new PeepsyChild('sequential');
      (child as any).isProcessing = true;

      const queue = (child as any).queue;
      if (queue) {
        queue.enqueue({ id: '1', action: 'test', data: {} }, 0, 5000);
        await (child as any).processQueue();

        // Queue should still have the item since processing was blocked
        expect(queue.size()).toBe(1);
      }
    });
  });

  describe('Concurrent Mode Coverage', () => {
    it('should handle REQUEST in concurrent mode with maxConcurrency', () => {
      const child = new PeepsyChild('concurrent', { maxConcurrency: 2 });
      child.registerHandler('test', (data: any) => ({ result: data }));

      const onCalls = mockProcess.on.mock.calls.find(call => call[0] === 'message');
      const messageHandler = onCalls?.[1];

      const requestMessage = {
        type: 'REQUEST',
        id: 'concurrent-req',
        action: 'test',
        data: { value: 42 },
      };

      expect(() => messageHandler(requestMessage)).not.toThrow();
    });

    it('should handle REQUEST in unlimited concurrent mode', () => {
      const child = new PeepsyChild('concurrent');
      child.registerHandler('test', (data: any) => ({ result: data }));

      const onCalls = mockProcess.on.mock.calls.find(call => call[0] === 'message');
      const messageHandler = onCalls?.[1];

      const requestMessage = {
        type: 'REQUEST',
        id: 'unlimited-req',
        action: 'test',
        data: { value: 42 },
      };

      expect(() => messageHandler(requestMessage)).not.toThrow();
    });

    it('should not have queue in unlimited concurrent mode', () => {
      const concurrentChild = new PeepsyChild('concurrent');
      expect(concurrentChild.getQueueSize()).toBe(0);
    });
  });

  describe('Graceful Shutdown Coverage', () => {
    let child: PeepsyChild;

    beforeEach(() => {
      child = new PeepsyChild('sequential');
    });

    it('should set shutdown flag during graceful shutdown', () => {
      expect((child as any).isShuttingDown).toBe(false);

      (child as any).gracefulShutdown();

      expect((child as any).isShuttingDown).toBe(true);
    });

    it('should not shutdown multiple times', async () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      const childWithLogger = new PeepsyChild('sequential', { logger });

      (childWithLogger as any).isShuttingDown = true;

      await (childWithLogger as any).gracefulShutdown();

      // Should return early
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Starting graceful shutdown')
      );
    });
  });

  describe('Custom Logger Coverage', () => {
    it('should use custom logger for initialization', () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      new PeepsyChild('sequential', { logger });

      expect(logger.debug).toHaveBeenCalledWith('PeepsyChild initialized in sequential mode');
    });
  });

  describe('Forced Shutdown Warning Coverage', () => {
    it('should warn when forced shutdown occurs with requests in progress', async () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const child = new PeepsyChild('concurrent', { logger });

      // Simulate requests in progress by setting the internal counter
      (child as any).requestsInProgress = 2;

      // Mock Date.now to simulate timeout condition
      const originalDateNow = Date.now;
      let callCount = 0;
      Date.now = jest.fn(() => {
        callCount++;
        // First call: start time (0)
        // Second call: check time (11000) - simulates timeout exceeded
        return callCount === 1 ? 0 : 11000;
      });

      try {
        await (child as any).gracefulShutdown();

        // Verify the forced shutdown warning was logged
        expect(logger.warn).toHaveBeenCalledWith(
          'Forced shutdown with 2 requests still in progress'
        );
      } finally {
        Date.now = originalDateNow;
      }
    }, 10000);

    it('should not warn when graceful shutdown completes without pending requests', async () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const child = new PeepsyChild('concurrent', { logger });

      // No requests in progress (requestsInProgress = 0)
      await (child as any).gracefulShutdown();

      // Verify no forced shutdown warning was logged
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Forced shutdown with'));
    }, 5000);
  });
});
