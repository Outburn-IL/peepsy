import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Child sequential queue behavior', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('second request waits behind delay in sequential mode', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    master.spawnChild('seq1', workerPath, 'sequential');

    const start = Date.now();
    const p1 = master.sendRequest('delay', 'seq1', { ms: 200 } as any);
    const p2 = master.sendRequest('echo', 'seq1', { val: 42 } as any);

    const r1 = await p1;
    const mid = Date.now();
    const r2 = await p2;
    const end = Date.now();

    expect(r1.status).toBe(200);
    expect(r1.data).toMatchObject({ delayed: 200 });

    expect(r2.status).toBe(200);
    expect(r2.data).toMatchObject({ echoed: { val: 42 } });

    // Ensure sequential ordering: r2 completes after ~200ms delay
    const t1 = mid - start;
    const t2 = end - start;
    expect(t1).toBeGreaterThanOrEqual(180);
    expect(t2).toBeGreaterThanOrEqual(200);

    await master.gracefulShutdown();
  });
});
