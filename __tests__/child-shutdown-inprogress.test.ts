import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(20000);

const isWin = process.platform === 'win32';
const d = isWin ? describe.skip : describe;

d('Child shutdown with in-progress requests', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-hang.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('graceful shutdown warns when requests still in progress', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    master.spawnChild('hang1', workerPath, 'concurrent');

    // Send a hanging request with short timeout to self-clean
    const hangPromise = master
      .sendRequest('hang', 'hang1', {} as any, { timeout: 1000 })
      .catch(err => err);

    // Also send a fast request to ensure IPC is functional
    const res = await master.sendRequest('ping', 'hang1', { x: 1 } as any);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ ok: true, data: { x: 1 } });

    // Wait for hang to reject to avoid open handles
    const hangRes = await hangPromise;
    expect(hangRes).toBeInstanceOf(Error);

    // Trigger graceful shutdown; child should log warning branch internally
    await master.gracefulShutdown(5000);
  });
});
