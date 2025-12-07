import { PeepsyMaster } from '../src/index';

jest.setTimeout(10000);

describe('Not found error path', () => {
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('sending to unknown target throws PeepsyNotFoundError', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    await expect(master.sendRequest('echo', 'unknown-target' as any)).rejects.toMatchObject({
      name: 'PeepsyNotFoundError',
      code: 'PEEPSY_NOT_FOUND',
    });
    await master.gracefulShutdown();
  });
});
