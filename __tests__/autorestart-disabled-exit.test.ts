import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Auto-restart disabled on exit', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('child exit does not auto-restart when disabled', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    const groupId = 'exit-no-restart';
    master.configureGroup(groupId, { strategy: 'round-robin', disableAutoRestart: true } as any);
    master.spawnChild('nr1', workerPath, 'sequential', groupId);

    const restartFired = new Promise<boolean>(resolve => {
      const t = setTimeout(() => resolve(false), 1000);
      master.once('auto-restart', () => {
        clearTimeout(t);
        resolve(true);
      });
    });

    await master.shutdownChild('nr1');
    const fired = await restartFired;
    expect(fired).toBe(false);
    expect(master.isProcessAlive('nr1')).toBe(false);
    await master.gracefulShutdown();
  });
});
