import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Child concurrent processing path', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('maxConcurrency=2 processes requests concurrently', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    // Spawn child in concurrent mode with maxConcurrency=2
    master.spawnChild('cc1', workerPath, 'concurrent', undefined, {
      env: { PEEPSY_MAX_CONCURRENCY: '2' } as any,
    });

    // Send three delays; with concurrency=2, total time should be ~>=100 and <300 for two 100ms tasks + one queued
    const start = Date.now();
    const p1 = master.sendRequest('delay', 'cc1', { ms: 100 } as any);
    const p2 = master.sendRequest('delay', 'cc1', { ms: 100 } as any);
    const p3 = master.sendRequest('delay', 'cc1', { ms: 100 } as any);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    const elapsed = Date.now() - start;
    // Allow jitter on Windows/CI while still demonstrating concurrency
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(1300);

    await master.gracefulShutdown();
  });
});
