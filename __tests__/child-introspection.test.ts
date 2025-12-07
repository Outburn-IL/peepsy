import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Child getters and shutdown branches', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-introspection.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('introspects child state and exercises shutdown', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    master.spawnChild('introspect', workerPath, 'sequential');

    // Prime with a delay to have in-progress handling
    await master.sendRequest('delay', 'introspect', { ms: 100 } as any);

    const res = await master.sendRequest('introspect', 'introspect');
    expect(res.status).toBe(200);
    const data: any = res.data;
    expect(typeof data.requestsHandled).toBe('number');
    expect(typeof data.requestsInProgress).toBe('number');
    expect(typeof data.queueSize).toBe('number');
    expect(['sequential', 'concurrent']).toContain(data.mode);
    expect(typeof data.isActive).toBe('boolean');
    expect(typeof data.handlerCount).toBe('number');
    expect(Array.isArray(data.handlerActions)).toBe(true);
    expect(data.handlerActions).toEqual(expect.arrayContaining(['echo', 'delay', 'introspect']));

    // Exercise child graceful shutdown branches (heartbeat/queue cleanup/listeners)
    await master.shutdownChild('introspect', 2000);
  });
});
