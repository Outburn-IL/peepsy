import { PeepsyMaster } from '../src/index';

jest.setTimeout(10000);

describe('Unknown strategy error', () => {
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

  test('configure unknown strategy and sendRequest throws', async () => {
    const master = new PeepsyMaster({ logger: silent } as any);
    master.configureGroup('bad', { strategy: 'non-existent' as any });
    // No children added; calling sendRequest should try to pick child for group and throw
    await expect(master.sendRequest('echo', 'bad' as any)).rejects.toMatchObject({
      name: 'PeepsyError',
      code: 'PEEPSY_ERROR',
    });
    await master.gracefulShutdown();
  });
});
