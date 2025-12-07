import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Heartbeat and auto-restart', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');

  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('master tracks heartbeat and emits missed event; auto-restart disabled', async () => {
    const master = new PeepsyMaster({
      heartbeatIntervalMs: 100,
      heartbeatMissThreshold: 1,
      logger: silent,
    } as any);
    const groupId = 'g1';

    // Configure group with auto-restart disabled
    master.configureGroup(groupId, {
      strategy: 'round-robin',
      disableAutoRestart: true,
      // group-level config won't change master monitor thresholds in current API
    } as any);
    master.spawnChild('w1', workerPath, 'sequential', groupId);

    const missedPromise = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('missed heartbeat timeout')), 3000);
      master.once('heartbeat-missed', () => {
        clearTimeout(t);
        resolve();
      });
    });
    await missedPromise;
    const unhealthy = master.getUnhealthyProcesses();
    expect(unhealthy).toContain('w1');
    await master.gracefulShutdown();
  });

  test('auto-restart enabled triggers restart event', async () => {
    const master = new PeepsyMaster({
      heartbeatIntervalMs: 100,
      heartbeatMissThreshold: 1,
      logger: silent,
    } as any);
    const groupId = 'g2';

    master.configureGroup(groupId, {
      strategy: 'round-robin',
      disableAutoRestart: false,
      heartbeatMissThresholdMs: 300,
    } as any);

    master.spawnChild('w2', workerPath, 'sequential', groupId);

    const restarted = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('auto-restart timeout')), 3000);
      master.once('auto-restart', () => {
        clearTimeout(t);
        resolve();
      });
    });

    // Kill process to trigger exit and auto-restart
    await master.shutdownChild('w2');

    await restarted;
    await master.gracefulShutdown();
  });
});
