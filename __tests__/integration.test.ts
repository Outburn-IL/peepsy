/**
 * Integration tests for Peepsy
 */

import { PeepsyMaster, PeepsyError } from '../src/index';
import { join } from 'path';

describe('Peepsy Integration Tests', () => {
  let master: PeepsyMaster;
  const sequentialWorkerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');
  const concurrentWorkerPath = join(__dirname, 'fixtures', 'test-worker-concurrent.js');

  beforeEach(() => {
    master = new PeepsyMaster({ timeout: 10000 });
  });

  afterEach(async () => {
    await master.gracefulShutdown();
  });

  describe('Mixed Mode Operations', () => {
    beforeEach(() => {
      master.spawnChild('seq1', sequentialWorkerPath, 'sequential', 'seq-group');
      master.spawnChild('seq2', sequentialWorkerPath, 'sequential', 'seq-group');
      master.spawnChild('conc1', concurrentWorkerPath, 'concurrent', 'conc-group');
      master.spawnChild('conc2', concurrentWorkerPath, 'concurrent', 'conc-group');
    });

    it('should handle mixed sequential and concurrent operations', async () => {
      const results = await Promise.all([
        master.sendRequest('echo', 'seq-group', { type: 'sequential', id: 1 }),
        master.sendRequest('echo', 'conc-group', { type: 'concurrent', id: 2 }),
        master.sendRequest('add', 'seq1', { a: 5, b: 3 }),
        master.sendRequest('multiply', 'conc1', { a: 4, b: 7 }),
      ]);

      expect(results).toHaveLength(4);
      results.forEach(result => {
        expect(result.status).toBe(200);
      });

      expect(results[2].data).toEqual({ result: 8 }); // 5 + 3
      expect(results[3].data).toEqual({ result: 28 }); // 4 * 7
    });

    it('should handle concurrent long-running tasks', async () => {
      const start = Date.now();
      
      const results = await Promise.all([
        master.sendRequest('longTask', 'conc1', { duration: 200 }),
        master.sendRequest('longTask', 'conc2', { duration: 200 }),
        master.sendRequest('longTask', 'conc1', { duration: 200 }),
      ]);

      const duration = Date.now() - start;
      
      // Should complete in roughly 200ms (concurrent), not 600ms (sequential)
      expect(duration).toBeLessThan(400);
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.status).toBe(200);
        expect(result.data).toEqual({ completed: true, duration: 200 });
      });
    });

    it('should handle load balancing across groups', async () => {
      // Send many requests to verify round-robin distribution
      const requests = Array.from({ length: 10 }, (_, i) => 
        master.sendRequest('echo', 'seq-group', { requestId: i })
      );

      const results = await Promise.all(requests);
      
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.status).toBe(200);
      });
      
      // Check that both processes in the group handled requests
      const seqStats = master.getGroupStats('seq-group');
      expect(seqStats).toBeDefined();
      expect(seqStats!.totalRequests).toBeGreaterThan(0);
    });
  });

  describe('Bidirectional Communication', () => {
    beforeEach(() => {
      master.spawnChild('worker', sequentialWorkerPath, 'sequential');
      
      // Register handler on master for child requests
      master.registerHandler('masterAction', (data: any) => ({
        masterResponse: `Processed: ${data.from}`,
        timestamp: Date.now(),
      }));
    });

    it('should handle child-to-master requests', async () => {
      const response = await master.sendRequest('requestMaster', 'worker');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('masterResponse');
      expect((response.data as any).masterResponse).toHaveProperty('masterResponse');
    });
  });

  describe('Error Handling and Recovery', () => {
    beforeEach(() => {
      master.spawnChild('worker', sequentialWorkerPath, 'sequential');
    });

    it('should handle child process errors gracefully', async () => {
      await expect(
        master.sendRequest('error', 'worker', { message: 'from child' })
      ).rejects.toThrow(PeepsyError);
      
      // Verify error message
      try {
        await master.sendRequest('error', 'worker', { message: 'from child' });
      } catch (error) {
        expect((error as PeepsyError).message).toContain('Test error: from child');
      }
      
      // Process should still be alive and handle subsequent requests
      const nextResponse = await master.sendRequest('echo', 'worker', { test: 'after error' });
      expect(nextResponse.status).toBe(200);
    });

    it('should handle timeout scenarios', async () => {
      await expect(
        master.sendRequest('delay', 'worker', { ms: 2000 }, { timeout: 500 })
      ).rejects.toThrow('Request timed out');
      
      // Subsequent requests should still work
      const response = await master.sendRequest('echo', 'worker', { test: 'after timeout' });
      expect(response.status).toBe(200);
    });
  });

  describe('Performance and Scalability', () => {
    beforeEach(() => {
      // Spawn multiple workers for load testing
      for (let i = 1; i <= 5; i++) {
        master.spawnChild(`worker${i}`, sequentialWorkerPath, 'sequential', 'load-test');
      }
    });

    it('should handle high request volume', async () => {
      const requestCount = 100;
      const requests = Array.from({ length: requestCount }, (_, i) => 
        master.sendRequest('add', 'load-test', { a: i, b: i + 1 })
      );

      const start = Date.now();
      const results = await Promise.all(requests);
      const duration = Date.now() - start;

      expect(results).toHaveLength(requestCount);
      results.forEach((result, i) => {
        expect(result.status).toBe(200);
        expect(result.data).toEqual({ result: i + (i + 1) });
      });

      // Should complete within reasonable time
      expect(duration).toBeLessThan(10000); // 10 seconds max
      
      console.log(`Processed ${requestCount} requests in ${duration}ms`);
    }, 15000); // 15 second timeout for this test

    it('should maintain performance with concurrent operations', async () => {
      // Spawn concurrent workers
      for (let i = 1; i <= 3; i++) {
        master.spawnChild(`concurrent${i}`, concurrentWorkerPath, 'concurrent', 'conc-load');
      }

      const concurrentRequests = Array.from({ length: 50 }, () => 
        master.sendRequest('longTask', 'conc-load', { duration: 100 })
      );

      const start = Date.now();
      const results = await Promise.all(concurrentRequests);
      const duration = Date.now() - start;

      expect(results).toHaveLength(50);
      
      // With 3 concurrent workers, 50 requests of 100ms each should complete much faster
      // than 5000ms (50 * 100ms sequential)
      expect(duration).toBeLessThan(2000);
    }, 10000);
  });

  describe('Resource Management', () => {
    it('should properly clean up resources on shutdown', async () => {
      master.spawnChild('worker1', sequentialWorkerPath, 'sequential');
      master.spawnChild('worker2', concurrentWorkerPath, 'concurrent');
      
      expect(master.isProcessAlive('worker1')).toBe(true);
      expect(master.isProcessAlive('worker2')).toBe(true);
      
      await master.gracefulShutdown();
      
      expect(master.isProcessAlive('worker1')).toBe(false);
      expect(master.isProcessAlive('worker2')).toBe(false);
    });

    it('should handle individual process shutdown', async () => {
      master.spawnChild('worker1', sequentialWorkerPath, 'sequential');
      master.spawnChild('worker2', sequentialWorkerPath, 'sequential');
      
      await master.shutdownChild('worker1');
      
      expect(master.isProcessAlive('worker1')).toBe(false);
      expect(master.isProcessAlive('worker2')).toBe(true);
      
      // Remaining worker should still function
      const response = await master.sendRequest('echo', 'worker2', { test: 'still works' });
      expect(response.status).toBe(200);
    });
  });

  describe('Statistics and Monitoring', () => {
    beforeEach(() => {
      master.spawnChild('worker1', sequentialWorkerPath, 'sequential', 'test-group');
      master.spawnChild('worker2', sequentialWorkerPath, 'sequential', 'test-group');
    });

    it('should provide accurate statistics', async () => {
      // Send multiple requests
      await Promise.all([
        master.sendRequest('echo', 'worker1', { id: 1 }),
        master.sendRequest('add', 'worker1', { a: 1, b: 2 }),
        master.sendRequest('echo', 'worker2', { id: 2 }),
      ]);

      const worker1Stats = master.getProcessStats('worker1');
      const worker2Stats = master.getProcessStats('worker2');
      const groupStats = master.getGroupStats('test-group');

      expect(worker1Stats?.requestsHandled).toBe(2);
      expect(worker2Stats?.requestsHandled).toBe(1);
      expect(groupStats?.totalRequests).toBe(3);
    });

    it('should track active requests', async () => {
      const initialActive = master.getActiveRequestsCount();
      expect(initialActive).toBe(0);

      // Start a long request
      const longRequestPromise = master.sendRequest('delay', 'worker1', { ms: 500 });
      
      // Check active count during request
      expect(master.getActiveRequestsCount()).toBe(1);
      
      await longRequestPromise;
      
      // Should be back to 0 after completion
      expect(master.getActiveRequestsCount()).toBe(0);
    });
  });
});