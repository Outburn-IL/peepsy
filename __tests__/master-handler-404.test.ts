import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Master handler 404 branch', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('child requests unknown master action -> 404 path', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    master.spawnChild('mh1', workerPath, 'sequential');

    // Ask child to call child.sendRequest('masterAction'), but master has no handler registered
    const promise = master
      .sendRequest('requestMaster', 'mh1', { payload: 1 } as any)
      .catch(err => err);
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toContain('No handler registered for action: masterAction');

    await master.gracefulShutdown();
  });
});
