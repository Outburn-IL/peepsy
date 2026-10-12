import { join } from 'path';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { ChildProcessEntry, NoOpLogger, PeepsyMaster, PeepsyRequestContext } from '../src/index';

jest.setTimeout(10000);

describe('supervised process lifecycle', () => {
  const worker = join(__dirname, 'fixtures', 'lifecycle-worker.js');
  const masters: PeepsyMaster[] = [];
  const createMaster = () => {
    const master = new PeepsyMaster({ logger: new NoOpLogger(), handleSignals: false });
    masters.push(master);
    return master;
  };
  const spawn = (master: PeepsyMaster, target = 'worker', group?: string) => {
    master.spawnChild(target, worker, 'concurrent', group, {
      disableAutoRestart: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
  };
  const entryFor = (master: PeepsyMaster, target = 'worker') =>
    (Reflect.get(master, 'processes') as Map<string, ChildProcessEntry>).get(target)!;
  afterEach(async () => {
    await Promise.all(masters.splice(0).map(master => master.gracefulShutdown(200)));
  });

  test('derives frozen sender context from transport, ignoring forged payload fields', async () => {
    const master = createMaster();
    master.registerHandler('identify', (_data, context) => {
      expect(Object.isFrozen(context)).toBe(true);
      return context;
    });
    spawn(master);
    const entry = entryFor(master);
    const result = await master.sendRequest<unknown, PeepsyRequestContext>('callMaster', 'worker', {
      action: 'identify',
      data: { target: 'forged', pid: -1, processInstanceId: 'forged', requestId: 'forged' },
    });
    expect(result.data).toMatchObject({
      target: 'worker',
      pid: entry.child.pid,
      processInstanceId: entry.processInstanceId,
    });
    expect(result.data?.requestId).not.toBe('forged');
    expect(master.getActiveRequestsCount()).toBe(0);
    expect((await master.sendRequest('pendingCount', 'worker')).data).toBe(0);
  });

  test('catches synchronous handler throws without logging raw errors', async () => {
    const master = createMaster();
    const logger = Reflect.get(master, 'logger') as NoOpLogger;
    const log = jest.spyOn(logger, 'error');
    master.registerHandler('fail', () => {
      throw new Error('private-callback-payload');
    });
    spawn(master);
    await expect(master.sendRequest('callMaster', 'worker', { action: 'fail' })).rejects.toThrow(
      'private-callback-payload'
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-callback-payload');
    expect(master.getActiveRequestsCount()).toBe(0);
  });

  test('serialization and send-callback failures settle requests and counters once', async () => {
    const master = createMaster();
    spawn(master);
    await master.sendRequest('echo', 'worker', {});
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expect(master.sendRequest('echo', 'worker', cyclic)).rejects.toThrow();
    const entry = entryFor(master);
    jest.spyOn(entry.child, 'send').mockImplementationOnce(((
      _message: unknown,
      ...args: unknown[]
    ) => {
      const callback = args.find(value => typeof value === 'function') as (error: Error) => void;
      callback(new Error('send failed'));
      return false;
    }) as typeof entry.child.send);
    await expect(master.sendRequest('echo', 'worker', {})).rejects.toThrow('send failed');
    expect(master.getActiveRequestsCount()).toBe(0);
    expect(master.getProcessStats('worker')?.requestsActive).toBe(0);
  });

  test.each(['crash', 'disconnect'])(
    '%s promptly rejects all requests and confirms child cleanup',
    async action => {
      const master = createMaster();
      spawn(master);
      await master.sendRequest('echo', 'worker', {});
      const entry = entryFor(master);
      const exited = new Promise<void>(resolve => master.once('exit', () => resolve()));
      const pending = [
        master.sendRequest('delay', 'worker', { ms: 5000 }),
        master.sendRequest(action, 'worker'),
      ];
      const results = await Promise.allSettled(pending);
      expect(results.every(result => result.status === 'rejected')).toBe(true);
      await exited;
      expect(master.getActiveRequestsCount()).toBe(0);
      expect(master.isProcessAlive('worker')).toBe(false);
      expect(() => process.kill(entry.child.pid!, 0)).toThrow();
    }
  );

  test('intentional termination suppresses restart, emits identity, and fences stale events', async () => {
    const master = createMaster();
    const events: unknown[] = [];
    master.on('exit', event => events.push(event));
    master.spawnChild('worker', worker, 'concurrent', undefined, {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    await master.sendRequest('echo', 'worker', {});
    const old = entryFor(master);
    const pending = master.sendRequest('delay', 'worker', { ms: 5000 });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'PEEPSY_PROCESS' });
    await master.terminateChild('worker');
    await rejected;
    expect(events).toEqual([
      expect.objectContaining({
        target: 'worker',
        processInstanceId: old.processInstanceId,
        intentional: true,
      }),
    ]);
    expect(master.isProcessAlive('worker')).toBe(false);
    expect(old.child.listenerCount('message')).toBe(0);
    expect(old.child.listenerCount('exit')).toBe(0);
    expect(old.child.listenerCount('disconnect')).toBe(0);
    spawn(master);
    const replacement = entryFor(master);
    expect(replacement.processInstanceId).not.toBe(old.processInstanceId);
    const handler = jest.fn();
    master.registerHandler('stale', handler);
    old.child.emit('message', { type: 'REQUEST', id: 'old', action: 'stale' });
    old.child.emit('exit', 0, null);
    expect(handler).not.toHaveBeenCalled();
    expect(master.isProcessAlive('worker')).toBe(true);
    expect((await master.sendRequest('echo', 'worker', 'replacement')).data).toBe('replacement');
  });

  test('shutdownChild alone is intentional even when auto-restart defaults on', async () => {
    const master = createMaster();
    master.spawnChild('worker', worker, 'concurrent', undefined, {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    await master.shutdownChild('worker', 100);
    expect(master.isProcessAlive('worker')).toBe(false);
    expect(master.getAllProcessStats()).toEqual({});
  });

  test('fails boundedly without dropping ownership when termination is unconfirmed', async () => {
    const master = createMaster();
    const child = Object.assign(new EventEmitter(), {
      connected: true,
      send: jest.fn(),
      kill: jest.fn().mockReturnValue(false),
    }) as unknown as ChildProcess;
    const entry: ChildProcessEntry = {
      child,
      mode: 'concurrent',
      processInstanceId: 'mock-instance',
    };
    (Reflect.get(master, 'processes') as Map<string, ChildProcessEntry>).set('mock', entry);
    Reflect.get(master, 'initializeProcessStats').call(master, 'mock');
    Reflect.get(master, 'setupChildEventHandlers').call(master, child, 'mock');
    jest.useFakeTimers();
    try {
      const graceful = master.shutdownChild('mock', 10000);
      const forced = master.terminateChild('mock');
      const rejected = expect(forced).rejects.toThrow(
        'Termination was not confirmed within 2000ms'
      );
      const alsoRejected = expect(graceful).rejects.toThrow('Termination was not confirmed');
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      jest.advanceTimersByTime(2000);
      await Promise.all([rejected, alsoRejected]);
      expect(entryFor(master, 'mock')).toBe(entry);
      expect(child.listenerCount('exit')).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      child.emit('close', null, null);
      jest.useRealTimers();
    }
    expect(master.isProcessAlive('mock')).toBe(false);
    expect(child.listenerCount('message')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
  });

  test('failed forks that emit close without exit roll back tracked ownership', async () => {
    const master = createMaster();
    const closed = new Promise<void>(resolve => master.once('exit', () => resolve()));
    master.spawnChild('missing', worker, 'concurrent', undefined, {
      execPath: join(__dirname, 'does-not-exist.exe'),
      disableAutoRestart: true,
    });
    await closed;
    expect(master.isProcessAlive('missing')).toBe(false);
    expect(master.getActiveRequestsCount()).toBe(0);
    expect(master.getAllProcessStats()).toEqual({});
  });

  test('drops late host results after disconnect and responses from the wrong child', async () => {
    const master = createMaster();
    spawn(master);
    spawn(master, 'other');
    await Promise.all([
      master.sendRequest('echo', 'worker', {}),
      master.sendRequest('echo', 'other', {}),
    ]);
    const pending = master.sendRequest('delay', 'worker', { ms: 50, value: 'actual' });
    const requests = Reflect.get(master, 'activeRequests') as Map<string, unknown>;
    entryFor(master, 'other').child.emit('message', {
      type: 'RESPONSE',
      id: [...requests.keys()][0],
      status: 200,
      data: 'forged',
    });
    expect((await pending).data).toBe('actual');
    let finish!: (value: string) => void;
    let admitted!: () => void;
    const started = new Promise<void>(resolve => {
      admitted = resolve;
    });
    master.registerHandler('late', () => {
      admitted();
      return new Promise<string>(resolve => {
        finish = resolve;
      });
    });
    const entry = entryFor(master);
    const send = jest.spyOn(entry.child, 'send');
    const request = master.sendRequest('callMaster', 'worker', { action: 'late' });
    const rejected = expect(request).rejects.toMatchObject({ code: 'PEEPSY_PROCESS' });
    await started;
    await master.terminateChild('worker');
    await rejected;
    send.mockClear();
    finish('private-late-result');
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(send).not.toHaveBeenCalled();
  });

  test('timeout frees group capacity and late replies cannot decrement a newer request', async () => {
    const master = createMaster();
    master.configureGroup('group', { maxConcurrency: 1 });
    spawn(master, 'worker', 'group');
    await master.sendRequest('echo', 'worker', {});
    const timeout = master.sendRequest(
      'delay',
      'group',
      { ms: 150, value: 'late' },
      { timeout: 30 }
    );
    const failed = expect(timeout).rejects.toMatchObject({ code: 'PEEPSY_TIMEOUT' });
    const queued = master.sendRequest('delay', 'group', { ms: 250, value: 'queued' });
    await failed;
    expect((await queued).data).toBe('queued');
    expect(master.getActiveRequestsCount()).toBe(0);
    expect(master.getProcessStats('worker')?.requestsActive).toBe(0);
  });

  test('shutdown rejects active and queued work, force-kills blocked workers, and is idempotent', async () => {
    const master = createMaster();
    master.configureGroup('group', { maxConcurrency: 1 });
    spawn(master, 'worker', 'group');
    await master.sendRequest('echo', 'worker', {});
    const entry = entryFor(master);
    const active = master.sendRequest('block', 'group');
    const queued = master.sendRequest('echo', 'group');
    const results = Promise.allSettled([active, queued]);
    const stop = master.gracefulShutdown(50);
    expect(master.gracefulShutdown()).toBe(stop);
    await stop;
    expect((await results).every(result => result.status === 'rejected')).toBe(true);
    expect(master.getActiveRequestsCount()).toBe(0);
    expect(master.getAllProcessStats()).toEqual({});
    expect(() => process.kill(entry.child.pid!, 0)).toThrow();
  });

  test('opt-out signals and two default masters register and dispose listeners correctly', async () => {
    const initial = process.listenerCount('SIGTERM');
    const disabled = createMaster();
    expect(process.listenerCount('SIGTERM')).toBe(initial);
    const first = new PeepsyMaster({ logger: new NoOpLogger() });
    const second = new PeepsyMaster({ logger: new NoOpLogger() });
    masters.push(first, second);
    expect(process.listenerCount('SIGTERM')).toBe(initial + 1);
    await first.gracefulShutdown();
    expect(process.listenerCount('SIGTERM')).toBe(initial + 1);
    await second.gracefulShutdown();
    expect(process.listenerCount('SIGTERM')).toBe(initial);
    await disabled.gracefulShutdown();
  });

  test('applies explicit env, execArgv, stdio, and per-target restart settings', async () => {
    const master = createMaster();
    const previous = process.env['PEEPSY_AMBIENT'];
    process.env['PEEPSY_AMBIENT'] = 'not-inherited';
    try {
      master.spawnChild('worker', worker, 'concurrent', undefined, {
        inheritEnv: false,
        env: {
          PEEPSY_EXPLICIT: 'passed',
          ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}),
        },
        execArgv: ['--max-old-space-size=64'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        disableAutoRestart: true,
      });
      const result = await master.sendRequest('processConfig', 'worker');
      expect(result.data).toEqual({
        explicit: 'passed',
        execArgv: ['--max-old-space-size=64'],
        execPath: process.execPath,
      });
      expect(entryFor(master).disableAutoRestart).toBe(true);
    } finally {
      if (previous === undefined) delete process.env['PEEPSY_AMBIENT'];
      else process.env['PEEPSY_AMBIENT'] = previous;
    }
  });
});
