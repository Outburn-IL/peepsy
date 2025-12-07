import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Timeouts and retries', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('request times out and triggers retry path', async () => {
    const master = new PeepsyMaster({
      timeout: 50,
      maxRetries: 1,
      retryDelay: 10,
      logger: silent,
    } as any);
    const groupId = 'tg';
    master.configureGroup(groupId, { strategy: 'round-robin' } as any);
    master.spawnChild('t1', workerPath, 'sequential', groupId);

    // action 'delay' should sleep longer than timeout to force timeout
    await expect(
      master.sendRequest('delay', groupId, { ms: 200 } as any, { timeout: 50, retries: 1 })
    ).rejects.toMatchObject({ name: 'PeepsyTimeoutError', code: 'PEEPSY_TIMEOUT' });

    await master.gracefulShutdown();
  });

  test('group queueing engages when maxConcurrency reached', async () => {
    const master = new PeepsyMaster({ timeout: 1000, logger: silent } as any);
    const groupId = 'qg';
    master.configureGroup(groupId, { strategy: 'round-robin', maxConcurrency: 1 } as any);
    master.spawnChild('q1', workerPath, 'sequential', groupId);

    const p1 = master.sendRequest('delay', groupId, { ms: 200 } as any);
    const start = Date.now();
    const p2 = master.sendRequest('delay', groupId, { ms: 10 } as any);
    const r1 = await p1;
    const r2 = await p2;
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // p2 should have waited behind p1 due to maxConcurrency
    expect(Date.now() - start).toBeGreaterThanOrEqual(180);
    await master.gracefulShutdown();
  });
});
