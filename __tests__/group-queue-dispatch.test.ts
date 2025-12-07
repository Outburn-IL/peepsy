import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Group queue dispatch when capacity frees', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('queues requests over maxConcurrency and dispatches when one completes', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    // Configure group with maxConcurrency = 1
    master.configureGroup('gq1', { strategy: 'round-robin', maxConcurrency: 1 });
    master.spawnChild('t1', workerPath, 'sequential', 'gq1');

    // First request occupies capacity for a bit
    const p1 = master.sendRequest('delay', 'gq1', { ms: 200 } as any);

    // Second request should be queued until p1 finishes
    const start = Date.now();
    const p2 = master.sendRequest('echo', 'gq1', { queued: true } as any);

    const r1 = await p1;
    expect(r1.status).toBe(200);
    const r2 = await p2;
    expect(r2.status).toBe(200);
    expect(r2.data).toMatchObject({ echoed: { queued: true } });

    // Ensure p2 was delayed (queued) for at least ~150ms
    expect(Date.now() - start).toBeGreaterThanOrEqual(150);

    await master.gracefulShutdown();
  });
});
