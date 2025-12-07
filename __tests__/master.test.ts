/**
 * Tests for PeepsyMaster class
 */

import { PeepsyMaster, PeepsyError, PeepsyTimeoutError, PeepsyNotFoundError } from '../src/index';
import { join } from 'path';

describe('PeepsyMaster', () => {
  let master: PeepsyMaster;

  beforeEach(() => {
    master = new PeepsyMaster({ timeout: 5000 });
  });

  afterEach(async () => {
    await master.gracefulShutdown();
  });

  describe('Constructor', () => {
    it('should create a master with default options', () => {
      const defaultMaster = new PeepsyMaster();
      expect(defaultMaster).toBeInstanceOf(PeepsyMaster);
    });

    it('should throw error with invalid timeout', () => {
      expect(() => new PeepsyMaster({ timeout: -1 })).toThrow(PeepsyError);
      expect(() => new PeepsyMaster({ timeout: 400000 })).toThrow(PeepsyError);
    });
  });

  describe('Child Process Management', () => {
    const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');

    it('should spawn a child process successfully', () => {
      expect(() => {
        master.spawnChild('test-worker', workerPath, 'sequential');
      }).not.toThrow();

      expect(master.isProcessAlive('test-worker')).toBe(true);
    });

    it('should throw error when spawning duplicate target', () => {
      master.spawnChild('test-worker', workerPath, 'sequential');

      expect(() => {
        master.spawnChild('test-worker', workerPath, 'sequential');
      }).toThrow(PeepsyError);
    });

    it('should shutdown a child process', async () => {
      master.spawnChild('test-worker', workerPath, 'sequential');

      await master.shutdownChild('test-worker');

      expect(master.isProcessAlive('test-worker')).toBe(false);
    });

    it('should throw error when shutting down non-existent process', async () => {
      await expect(master.shutdownChild('non-existent')).rejects.toThrow(PeepsyNotFoundError);
    });
  });

  describe('Request Handling', () => {
    const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');

    beforeEach(() => {
      master.spawnChild('test-worker', workerPath, 'sequential');
    });

    it('should send request and receive response', async () => {
      const response = await master.sendRequest('echo', 'test-worker', { message: 'hello' });

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ echoed: { message: 'hello' } });
    });

    it('should handle arithmetic operations', async () => {
      const response = await master.sendRequest('add', 'test-worker', { a: 5, b: 3 });

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ result: 8 });
    });

    it('should handle delayed responses', async () => {
      const start = Date.now();
      const response = await master.sendRequest('delay', 'test-worker', { ms: 100 });
      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ delayed: 100 });
      expect(duration).toBeGreaterThanOrEqual(100);
    });

    it('should handle child errors', async () => {
      await expect(
        master.sendRequest('error', 'test-worker', { message: 'from child' })
      ).rejects.toThrow(PeepsyError);

      // Verify error message
      try {
        await master.sendRequest('error', 'test-worker', { message: 'from child' });
      } catch (error) {
        expect((error as PeepsyError).message).toContain('Test error: from child');
      }
    });

    it('should timeout on long requests', async () => {
      await expect(
        master.sendRequest('delay', 'test-worker', { ms: 6000 }, { timeout: 1000 })
      ).rejects.toThrow(PeepsyTimeoutError);
    });

    it('should throw error for non-existent target', async () => {
      await expect(
        master.sendRequest('echo', 'non-existent', { message: 'hello' })
      ).rejects.toThrow(PeepsyNotFoundError);
    });
  });

  describe('Group Management', () => {
    const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');

    beforeEach(() => {
      master.spawnChild('worker1', workerPath, 'sequential', 'test-group');
      master.spawnChild('worker2', workerPath, 'sequential', 'test-group');
      master.spawnChild('worker3', workerPath, 'sequential', 'test-group');
    });

    it('should distribute requests across group members', async () => {
      const responses = await Promise.all([
        master.sendRequest('echo', 'test-group', { id: 1 }),
        master.sendRequest('echo', 'test-group', { id: 2 }),
        master.sendRequest('echo', 'test-group', { id: 3 }),
      ]);

      expect(responses).toHaveLength(3);
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should get group statistics', async () => {
      await master.sendRequest('echo', 'test-group', { message: 'test' });

      const stats = master.getGroupStats('test-group');

      expect(stats).toBeDefined();
      expect(stats!.strategy).toBe('round-robin');
      expect(Object.keys(stats!.processes)).toHaveLength(3);
    });

    it('supports random and least-busy strategies', async () => {
      master.configureGroup('test-group', { strategy: 'random' } as any);
      const r1 = await master.sendRequest('echo', 'test-group', { id: 'r1' });
      expect(r1.status).toBe(200);

      master.configureGroup('test-group', { strategy: 'least-busy' } as any);
      const r2 = await master.sendRequest('echo', 'test-group', { id: 'r2' });
      expect(r2.status).toBe(200);
    });
  });

  describe('Handler Registration', () => {
    const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');

    beforeEach(() => {
      master.spawnChild('test-worker', workerPath, 'sequential');
    });

    it('should register and handle master-side handlers', async () => {
      master.registerHandler('masterAction', (data: any) => {
        return { processed: data, timestamp: Date.now() };
      });

      const response = await master.sendRequest('requestMaster', 'test-worker');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('masterResponse');
    });

    it('should unregister handlers', () => {
      master.registerHandler('testAction', () => ({ result: 'test' }));
      expect(master.unregisterHandler('testAction')).toBe(true);
      expect(master.unregisterHandler('testAction')).toBe(false);
    });
  });

  describe('Statistics and Monitoring', () => {
    const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');

    beforeEach(() => {
      master.spawnChild('test-worker', workerPath, 'sequential');
    });

    it('should track process statistics', async () => {
      await master.sendRequest('echo', 'test-worker', { message: 'test' });

      const stats = master.getProcessStats('test-worker');

      expect(stats).toBeDefined();
      expect(stats!.requestsHandled).toBe(1);
      expect(stats!.errors).toBe(0);
    });

    it('should track all process statistics', async () => {
      await master.sendRequest('echo', 'test-worker', { message: 'test' });

      const allStats = master.getAllProcessStats();

      expect(allStats).toHaveProperty('test-worker');
      expect(allStats['test-worker']?.requestsHandled).toBe(1);
    });

    it('should track active requests count', async () => {
      const initialCount = master.getActiveRequestsCount();
      expect(initialCount).toBe(0);

      const promise = master.sendRequest('delay', 'test-worker', { ms: 100 });

      // During the request, count should be 1
      expect(master.getActiveRequestsCount()).toBe(1);

      await promise;

      // After completion, count should be 0
      expect(master.getActiveRequestsCount()).toBe(0);
    });
  });

  describe('Retry Mechanism', () => {
    const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');

    beforeEach(() => {
      master.spawnChild('test-worker', workerPath, 'sequential');
    });

    it('should retry failed requests', async () => {
      const masterWithRetries = new PeepsyMaster({
        timeout: 5000,
        maxRetries: 2,
        retryDelay: 100,
      });

      masterWithRetries.spawnChild('test-worker', workerPath, 'sequential');

      // First request should work
      const response = await masterWithRetries.sendRequest('echo', 'test-worker', {
        message: 'test',
      });
      expect(response.status).toBe(200);

      await masterWithRetries.gracefulShutdown();
    });
  });

  describe('Graceful Shutdown', () => {
    const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');

    it('should shutdown all processes gracefully', async () => {
      master.spawnChild('worker1', workerPath, 'sequential');
      master.spawnChild('worker2', workerPath, 'sequential');

      expect(master.isProcessAlive('worker1')).toBe(true);
      expect(master.isProcessAlive('worker2')).toBe(true);

      await master.gracefulShutdown();

      expect(master.isProcessAlive('worker1')).toBe(false);
      expect(master.isProcessAlive('worker2')).toBe(false);
    });
  });
});
