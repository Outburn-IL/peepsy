import { PeepsyChild, NoOpLogger } from '../../dist/index.mjs';

const child = new PeepsyChild('concurrent', { logger: new NoOpLogger(), handleSignals: false });
child.registerHandler('echo', data => data);
child.registerHandler('delay', async data => {
  await new Promise(resolve => setTimeout(resolve, data.ms));
  return data.value;
});
child.registerHandler('callMaster', data =>
  child.sendRequest(data.action, data.data, { timeout: data.timeout ?? 1000 })
);
child.registerHandler('pendingCount', () => child.getActiveRequestsCount());
child.registerHandler('crash', () => process.exit(7));
child.registerHandler('disconnect', () => process.disconnect());
child.registerHandler('block', () => {
  while (true) {}
});
child.registerHandler('processConfig', () => ({
  execArgv: process.execArgv,
  explicit: process.env.PEEPSY_EXPLICIT,
  ambient: process.env.PEEPSY_AMBIENT,
  execPath: process.execPath,
}));
