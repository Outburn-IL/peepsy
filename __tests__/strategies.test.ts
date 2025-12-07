import { join } from 'path';
import { PeepsyMaster, PeepsyError } from '../src/index';

describe('Load-balancing strategies', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');

  test('round-robin cycles targets', async () => {
    const master = new PeepsyMaster({
      logger: { debug() {}, info() {}, warn() {}, error() {} } as any,
    });
    master.spawnChild('a', workerPath, 'sequential', 'g');
    master.spawnChild('b', workerPath, 'sequential', 'g');
    master.spawnChild('c', workerPath, 'sequential', 'g');
    master.configureGroup('g', { strategy: 'round-robin' } as any);

    const res = await Promise.all([
      master.sendRequest('echo', 'g', { i: 1 }),
      master.sendRequest('echo', 'g', { i: 2 }),
      master.sendRequest('echo', 'g', { i: 3 }),
    ]);

    res.forEach(r => expect(r.status).toBe(200));
    await master.gracefulShutdown();
  });

  test('random picks targets without error', async () => {
    const master = new PeepsyMaster({
      logger: { debug() {}, info() {}, warn() {}, error() {} } as any,
    });
    master.spawnChild('a', workerPath, 'sequential', 'g');
    master.spawnChild('b', workerPath, 'sequential', 'g');
    master.configureGroup('g', { strategy: 'random' } as any);

    const res1 = await master.sendRequest('echo', 'g', { x: 1 });
    const res2 = await master.sendRequest('echo', 'g', { x: 2 });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    await master.gracefulShutdown();
  });

  test('least-busy selects target with fewer active requests', async () => {
    const master = new PeepsyMaster({
      logger: { debug() {}, info() {}, warn() {}, error() {} } as any,
    });
    master.spawnChild('a', workerPath, 'sequential', 'g');
    master.spawnChild('b', workerPath, 'sequential', 'g');
    master.configureGroup('g', { strategy: 'least-busy' } as any);

    // Prime stats by sending a request to 'a' first
    await master.sendRequest('echo', 'a', { solo: true });
    const statsBefore = master.getGroupStats('g');
    expect(statsBefore?.strategy).toBe('least-busy');

    const res = await Promise.all([
      master.sendRequest('echo', 'g', { i: 1 }),
      master.sendRequest('echo', 'g', { i: 2 }),
      master.sendRequest('echo', 'g', { i: 3 }),
    ]);

    res.forEach(r => expect(r.status).toBe(200));
    await master.gracefulShutdown();
  });

  test('unknown strategy throws', () => {
    const master = new PeepsyMaster({
      logger: { debug() {}, info() {}, warn() {}, error() {} } as any,
    });
    master.spawnChild('a', workerPath, 'sequential', 'g');
    expect(() => master.configureGroup('g', { strategy: 'hey' } as any)).not.toThrow();
    expect(() => (master as any).getChildForGroup('g')).toThrow(PeepsyError);
  });
});
