import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Child queue cleanup and heartbeat stop branches', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('shutdown while short tasks queued exercises cleanup branches', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    master.spawnChild('hbq', workerPath, 'sequential');

    // Queue a few short delays to ensure queue exists
    const p1 = master.sendRequest('delay', 'hbq', { ms: 150 } as any);
    const p2 = master.sendRequest('delay', 'hbq', { ms: 150 } as any);
    await Promise.all([p1, p2]);

    // Trigger shutdown to invoke child's stopQueueCleanup and stopHeartbeat branches
    await master.shutdownChild('hbq', 2000);
  });
});
