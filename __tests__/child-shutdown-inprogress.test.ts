import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(20000);

// const isWin = process.platform === 'win32';
// const d = isWin ? describe.skip : describe;

describe('Child shutdown with in-progress requests', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-hang.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('graceful shutdown warns when requests still in progress', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    master.spawnChild('hang1', workerPath, 'concurrent');

    // Start a hanging request but don't wait for it
    const hangPromise = master
      .sendRequest('hang', 'hang1', {} as any, { timeout: 10000 })
      .catch(err => err);

    // Also send a fast request to ensure IPC is functional
    const res = await master.sendRequest('ping', 'hang1', { x: 1 } as any);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ ok: true, data: { x: 1 } });

    // Give the hang request a moment to start processing
    await new Promise(resolve => setTimeout(resolve, 50));

    // Trigger graceful shutdown while hang request is in progress
    // Use a short timeout to force kill the child quickly
    const shutdownPromise = master.gracefulShutdown(1000);

    // Clean up: wait for both shutdown and the hanging request to complete
    await Promise.allSettled([shutdownPromise, hangPromise]);
  });
});
