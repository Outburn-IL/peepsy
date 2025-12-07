import { join } from 'path';
import { PeepsyMaster } from '../src/index';

jest.setTimeout(15000);

describe('Response mapping with errorPayload', () => {
  const workerPath = join(__dirname, 'fixtures', 'test-worker-sequential.js');
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('maps errorPayload to error string in master', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    master.spawnChild('rm1', workerPath, 'sequential');

    const res = await master
      .sendRequest('error', 'rm1', { message: 'from child' } as any)
      .catch(err => err);

    expect(res).toBeInstanceOf(Error);
    expect(String(res.message)).toContain('Test error: from child');

    await master.gracefulShutdown();
  });
});
