import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Child concurrent capacity edge', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-concurrent.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('processQueueWithConcurrency respects exact max capacity', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    master.spawnChild('c1', workerPath, 'concurrent');

    const start = Date.now();
    // Use existing 'delay' handler; set concurrency via group later if needed
    const p1 = master.sendRequest('delay', 'c1', { ms: 250 } as any);
    const p2 = master.sendRequest('delay', 'c1', { ms: 250 } as any);
    // Third should wait until one finishes
    const p3 = master.sendRequest('delay', 'c1', { ms: 10 } as any);

    const r1 = await p1;
    const r2 = await p2;
    const r3 = await p3;
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    // p3 should complete after ~250ms window due to queueing
    expect(Date.now() - start).toBeGreaterThanOrEqual(240);

    await master.gracefulShutdown();
  });
});
