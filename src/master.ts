/**
 * PeepsyMaster - Master process for managing child processes and communication
 */

import { ChildProcess, fork, ForkOptions } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  ResponseMessage,
  RequestEnvelope,
  ResponseEnvelope,
  RequestMessage,
  ChildProcessEntry,
  ProcessMode,
  SpawnOptions,
  GroupConfig,
  ProcessStats,
  GroupStats,
  PeepsyOptions,
  PeepsyLogger,
  PeepsyError,
  PeepsyTimeoutError,
  PeepsyProcessError,
  PeepsyNotFoundError,
  PeepsyRequestContext,
} from './types';
import { DefaultLogger, delay, isValidTimeout, sanitizeError } from './utils';

interface PendingRequest {
  target: string;
  entry: ChildProcessEntry;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
  resolve: (response: ResponseMessage) => void;
  reject: (error: Error) => void;
}

export class PeepsyMaster extends EventEmitter {
  private static readonly signalMasters = new Set<PeepsyMaster>();
  private static readonly signalHandler = (): void => {
    for (const master of PeepsyMaster.signalMasters) {
      void master.gracefulShutdown().catch(() => master.logger.error('Signal shutdown failed'));
    }
  };
  private readonly processes: Map<string, ChildProcessEntry> = new Map();
  private readonly groups: Map<string, { targets: string[]; config: GroupConfig }> = new Map();
  private readonly roundRobinCounters: Map<string, number> = new Map();
  private readonly activeRequests: Map<string, PendingRequest> = new Map();
  private readonly groupQueues: Map<
    string,
    Array<{
      action: string;
      data: unknown;
      timeout: number;
      resolve: (r: ResponseMessage) => void;
      reject: (e: Error) => void;
    }>
  > = new Map();
  private readonly handlers: Map<
    string,
    (data: any, context: PeepsyRequestContext) => Promise<any> | any
  > = new Map();
  private readonly processStats: Map<string, ProcessStats> = new Map();
  private readonly logger: PeepsyLogger;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatMissThreshold: number;
  private isShuttingDown: boolean = false;
  private healthMonitor: ReturnType<typeof setInterval> | undefined = undefined;
  private shutdownPromise?: Promise<void>;
  private readonly stoppingProcesses = new Map<
    ChildProcessEntry,
    { promise: Promise<void>; forceKill: () => void }
  >();

  constructor(options: PeepsyOptions = {}) {
    super();
    this.timeout = options.timeout ?? 5000;
    this.maxRetries = options.maxRetries ?? 0;
    this.retryDelay = options.retryDelay ?? 1000;
    this.logger = options.logger ?? new DefaultLogger();
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 2000;
    this.heartbeatMissThreshold = options.heartbeatMissThreshold ?? 3;

    if (!isValidTimeout(this.timeout)) {
      throw new PeepsyError('Invalid timeout value. Must be a positive integer <= 300000ms');
    }

    if (options.handleSignals !== false) {
      if (PeepsyMaster.signalMasters.size === 0) {
        process.on('SIGINT', PeepsyMaster.signalHandler);
        process.on('SIGTERM', PeepsyMaster.signalHandler);
      }
      PeepsyMaster.signalMasters.add(this);
    }

    // Start health monitor to check heartbeats
    this.startHealthMonitor();
  }

  public spawnChild(
    target: string,
    scriptPath: string,
    mode: ProcessMode = 'sequential',
    groupId?: string,
    options: SpawnOptions = {}
  ): void {
    if (this.isShuttingDown) {
      throw new PeepsyError('Cannot spawn child during shutdown');
    }

    if (this.processes.has(target)) {
      throw new PeepsyError(`Process with target '${target}' already exists`);
    }

    this.logger.debug(`Spawning child process: ${target}`, { mode, groupId });

    try {
      const forkOptions: ForkOptions = {};
      if (options.execPath) forkOptions.execPath = options.execPath;
      if (options.silent !== undefined) forkOptions.silent = options.silent;
      if (options.execArgv !== undefined) forkOptions.execArgv = options.execArgv;
      if (options.stdio !== undefined) forkOptions.stdio = options.stdio;
      if (options.inheritEnv === false) forkOptions.env = { ...options.env };
      else if (options.env) forkOptions.env = { ...process.env, ...options.env };

      const child = fork(scriptPath, [], forkOptions);
      if (typeof child.unref === 'function') {
        // Allow Jest to exit without waiting on child process handles
        child.unref();
      }

      // Ensure process can be killed forcefully for tests
      if (process.env['NODE_ENV'] === 'test' || process.env['JEST_WORKER_ID']) {
        // In test environment, ensure we can force kill
        child.on('error', () => {
          // Ignore errors during test cleanup
        });

        // Ensure stdin/stdout/stderr are properly handled
        if (child.stdin) child.stdin.destroy();
        if (child.stdout) child.stdout.destroy();
        if (child.stderr) child.stderr.destroy();
      }
      const processEntry: ChildProcessEntry = {
        child,
        processInstanceId: randomUUID(),
        ...(options.disableAutoRestart !== undefined
          ? { disableAutoRestart: options.disableAutoRestart }
          : {}),
        mode,
        scriptPath,
        spawnOptions: options,
        ...(groupId ? { groupId } : {}),
      };

      this.processes.set(target, processEntry);
      this.initializeProcessStats(target);

      if (groupId) {
        this.addToGroup(target, groupId);
      }

      this.setupChildEventHandlers(child, target);
      try {
        child.send({ type: 'INIT', mode }, error => {
          if (error) this.handleTransportFailure(target, processEntry);
        });
      } catch {
        this.handleTransportFailure(target, processEntry);
        throw new PeepsyProcessError('Failed to initialize IPC', target);
      }

      this.logger.info(`Child process spawned: ${target}`, { pid: child.pid });
      this.emit('spawn', {
        type: 'spawn',
        timestamp: Date.now(),
        target,
        processInstanceId: processEntry.processInstanceId,
      });
    } catch {
      const errorMsg = `Failed to spawn child process: ${target}`;
      this.logger.error(errorMsg);
      throw new PeepsyProcessError(errorMsg, target);
    }
  }

  public registerHandler<TReq = unknown, TRes = unknown>(
    action: string,
    handler: (data: TReq, context: PeepsyRequestContext) => Promise<TRes> | TRes
  ): void {
    this.handlers.set(
      action,
      handler as unknown as (data: any, context: PeepsyRequestContext) => Promise<any> | any
    );
    this.logger.debug(`Handler registered for action: ${action}`);
  }

  public unregisterHandler(action: string): boolean {
    const removed = this.handlers.delete(action);
    if (removed) {
      this.logger.debug(`Handler unregistered for action: ${action}`);
    }
    return removed;
  }

  public async sendRequest<TReq = unknown, TRes = unknown>(
    action: string,
    targetOrGroup: string,
    data: TReq = {} as TReq,
    options: { timeout?: number; retries?: number } = {}
  ): Promise<{ status: number; data?: TRes; error?: string; id: string }> {
    const requestTimeout = options.timeout ?? this.timeout;
    const maxRetries = options.retries ?? this.maxRetries;

    if (!isValidTimeout(requestTimeout)) {
      throw new PeepsyError('Invalid timeout value');
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.debug(
            `Retry attempt ${attempt}/${maxRetries} for ${action} to ${targetOrGroup}`
          );
          await delay(this.retryDelay);
        }

        const response = await this.executeRequest(action, targetOrGroup, data, requestTimeout);

        if (attempt > 0) {
          this.logger.info(`Request succeeded on retry ${attempt}`, { action, targetOrGroup });
        }

        return response as unknown as { status: number; data?: TRes; error?: string; id: string };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Request attempt ${attempt + 1} failed`, {
          action,
          targetOrGroup,
          code: error instanceof PeepsyError ? error.code : 'PEEPSY_PROCESS',
        });
      }
    }

    throw lastError ?? new PeepsyError('Request failed after retries');
  }

  private async executeRequest(
    action: string,
    targetOrGroup: string,
    data: unknown,
    timeout: number
  ): Promise<ResponseMessage> {
    return new Promise((resolve, reject) => {
      if (this.isShuttingDown)
        return reject(new PeepsyError('Cannot send request during shutdown'));
      let processEntry: ChildProcessEntry | undefined;

      try {
        if (this.groups.has(targetOrGroup)) {
          // Enforce group maxConcurrency via queue
          const group = this.groups.get(targetOrGroup)!;
          const maxConcurrency = group.config.maxConcurrency;
          if (typeof maxConcurrency === 'number' && maxConcurrency > 0) {
            const active = group.targets.reduce(
              (sum, t) => sum + (this.processStats.get(t)?.requestsActive ?? 0),
              0
            );
            if (active >= maxConcurrency) {
              if (!this.groupQueues.has(targetOrGroup)) this.groupQueues.set(targetOrGroup, []);
              this.groupQueues.get(targetOrGroup)!.push({ action, data, timeout, resolve, reject });
              return; // will be dispatched when capacity frees
            }
          }
          processEntry = this.getChildForGroup(targetOrGroup);
        } else {
          processEntry = this.processes.get(targetOrGroup);
        }

        if (
          !processEntry ||
          processEntry.stopping ||
          processEntry.disconnected ||
          !processEntry.child.connected
        ) {
          return reject(new PeepsyNotFoundError(targetOrGroup));
        }

        const { child } = processEntry;
        const target = this.getTargetFromChild(child)!;
        const id = randomUUID();
        const request: RequestMessage = { id, action, data };

        const timeoutHandle = setTimeout(() => {
          this.settleRequest(id, undefined, new PeepsyTimeoutError(timeout, targetOrGroup));
        }, timeout);

        this.activeRequests.set(id, {
          target,
          entry: processEntry,
          timer: timeoutHandle,
          startedAt: Date.now(),
          resolve,
          reject,
        });
        this.updateProcessStats(target, { requestsActive: 1 });
        try {
          child.send({ type: 'REQUEST', request, timeout }, error => {
            if (error) this.settleRequest(id, undefined, error);
          });
        } catch (error) {
          this.settleRequest(
            id,
            undefined,
            error instanceof Error ? error : new PeepsyError('IPC send failed')
          );
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private settleRequest(
    id: string,
    response?: ResponseMessage,
    error?: Error,
    dispatch = true
  ): void {
    const pending = this.activeRequests.get(id);
    if (!pending) return;
    this.activeRequests.delete(id);
    clearTimeout(pending.timer);
    const failure =
      error ??
      (response && response.status >= 400
        ? new PeepsyError(response.error ?? `Request failed with status ${response.status}`)
        : undefined);
    if (this.processes.get(pending.target) === pending.entry) {
      this.updateProcessStats(pending.target, {
        requestsActive: -1,
        ...(response
          ? { requestsHandled: 1, averageResponseTime: Date.now() - pending.startedAt }
          : {}),
        ...(failure ? { errors: 1 } : {}),
      });
    }
    if (failure) pending.reject(failure);
    else pending.resolve(response!);
    if (dispatch) this.maybeDispatchQueued(pending.target);
  }

  private rejectTargetRequests(target: string, entry: ChildProcessEntry): void {
    for (const [id, pending] of this.activeRequests) {
      if (pending.entry === entry)
        this.settleRequest(
          id,
          undefined,
          new PeepsyProcessError('IPC process unavailable', target),
          false
        );
    }
  }

  private handleTransportFailure(target: string, entry: ChildProcessEntry): void {
    if (this.processes.get(target) !== entry) return;
    entry.disconnected = true;
    this.rejectTargetRequests(target, entry);
    void this.stopProcess(target, entry, 0, false).catch(() => {
      this.logger.error(`Child termination was not confirmed: ${target}`);
    });
  }

  private setupChildEventHandlers(child: ChildProcess, target: string): void {
    const entry = this.processes.get(target)!;
    const onMessage = (message: any): void => {
      if (
        this.processes.get(target) !== entry ||
        entry.stopping ||
        entry.disconnected ||
        !child.connected
      )
        return;
      try {
        if (message?.type === 'REQUEST') {
          this.handleChildRequest(message as RequestEnvelope, child);
        } else if (message?.type === 'RESPONSE' && this.activeRequests.has(message.id)) {
          const pending = this.activeRequests.get(message.id);
          if (pending?.entry.child === child) {
            const env = message as ResponseEnvelope;
            const errStr = env.error ?? env.errorPayload?.message;
            const mapped: ResponseMessage = errStr
              ? { id: env.id, status: env.status, data: env.data, error: errStr }
              : { id: env.id, status: env.status, data: env.data };
            this.settleRequest(message.id, mapped);
          }
        } else if (message?.type === 'HEARTBEAT') {
          const ts = message.timestamp ?? Date.now();
          this.updateProcessStats(target, { lastHeartbeatAt: ts, lastActivity: ts });
        }
      } catch {
        this.logger.error(`Error handling message from child ${target}`);
      }
    };

    const onError = (error: Error): void => {
      if (this.processes.get(target) !== entry) return;
      this.logger.error(`Child process error: ${target}`);
      this.updateProcessStats(target, { errors: 1 });
      this.handleTransportFailure(target, entry);
      if (this.listenerCount('error') > 0)
        this.emit('error', {
          type: 'error',
          timestamp: Date.now(),
          target,
          error,
        });
    };

    const onExit = (code: number | null, signal: ChildProcess['signalCode']): void => {
      if (this.processes.get(target) !== entry) return;
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      child.removeListener('close', onExit);
      child.removeListener('disconnect', onDisconnect);
      this.logger.info(`Child process exited: ${target}`, { code, signal, pid: child.pid });
      const prev = entry;
      // Capture group config before cleanup (cleanup removes group entry)
      const groupId = prev?.groupId;
      const groupCfg = groupId ? this.groups.get(groupId)?.config : undefined;
      this.rejectTargetRequests(target, entry);
      this.cleanupProcess(target);
      this.emit('exit', {
        target,
        processInstanceId: entry.processInstanceId,
        code,
        signal,
        intentional: !!entry.stopping,
      });
      if (!this.isShuttingDown && !entry.stopping && prev.scriptPath) {
        const disableAutoRestart = prev.disableAutoRestart || groupCfg?.disableAutoRestart;
        try {
          if (!disableAutoRestart) {
            this.logger.warn(`Auto-restarting child ${target}`);
            this.emit('auto-restart', { target, code, signal });
            if (groupId && groupCfg) this.configureGroup(groupId, groupCfg);
            this.spawnChild(
              target,
              prev.scriptPath,
              prev.mode,
              prev.groupId,
              prev.spawnOptions ?? {}
            );
          } else {
            this.logger.warn(`Auto-restart disabled for ${target}`);
          }
        } catch {
          this.logger.error(`Failed to auto-restart child ${target}`);
        }
      }
      if (groupId) {
        const member = this.groups.get(groupId)?.targets[0];
        if (member) this.maybeDispatchQueued(member);
        else this.rejectGroupQueue(groupId);
      }
    };

    const onDisconnect = (): void => {
      this.logger.debug(`Child process disconnected: ${target}`);
      this.handleTransportFailure(target, entry);
    };
    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
    child.on('close', onExit);
    child.on('disconnect', onDisconnect);
  }

  // Attempt to dispatch the next queued request for any group containing the freed target
  private maybeDispatchQueued(targetFreed: string): void {
    if (this.isShuttingDown) return;
    for (const [groupId, group] of this.groups) {
      if (!group.targets.includes(targetFreed)) continue;
      const queue = this.groupQueues.get(groupId);
      const maxConcurrency = group.config.maxConcurrency ?? 0;
      if (!queue || queue.length === 0 || maxConcurrency <= 0) continue;
      while (queue.length > 0) {
        const active = group.targets.reduce(
          (sum, t) => sum + (this.processStats.get(t)?.requestsActive ?? 0),
          0
        );
        if (active >= maxConcurrency) break;
        const next = queue.shift();
        if (!next) break;
        void this.executeRequest(next.action, groupId, next.data, next.timeout)
          .then(next.resolve)
          .catch(next.reject);
      }
    }
  }

  private rejectGroupQueue(groupId: string): void {
    const queue = this.groupQueues.get(groupId);
    this.groupQueues.delete(groupId);
    for (const pending of queue ?? [])
      pending.reject(new PeepsyProcessError('Group unavailable', groupId));
  }

  private handleChildRequest(message: RequestEnvelope, child: ChildProcess): void {
    const { id, action, data } = message;
    const target = this.getTargetFromChild(child);
    if (!target) return;
    const entry = this.processes.get(target)!;
    if (entry.stopping || entry.disconnected || !child.connected || this.isShuttingDown) return;
    const send = (envelope: ResponseEnvelope): void => {
      if (
        this.processes.get(target) !== entry ||
        entry.stopping ||
        entry.disconnected ||
        !child.connected
      )
        return;
      try {
        child.send(envelope, error => {
          if (error) this.handleTransportFailure(target, entry);
        });
      } catch {
        this.handleTransportFailure(target, entry);
      }
    };

    if (this.handlers.has(action)) {
      const handler = this.handlers.get(action)!;
      const context = Object.freeze({
        target,
        pid: child.pid,
        requestId: id,
        processInstanceId: entry.processInstanceId,
      });
      Promise.resolve()
        .then(() => {
          if (
            this.processes.get(target) !== entry ||
            entry.stopping ||
            entry.disconnected ||
            !child.connected
          )
            throw new PeepsyProcessError('IPC process unavailable', target);
          return handler(data, context);
        })
        .then(response => {
          const envelope: ResponseEnvelope = { type: 'RESPONSE', id, status: 200, data: response };
          send(envelope);
        })
        .catch(error => {
          const sanitized = sanitizeError(error);
          const envelope: ResponseEnvelope = {
            type: 'RESPONSE',
            id,
            status: 500,
            error: sanitized.message,
            errorPayload: sanitized.stack
              ? { name: 'Error', message: sanitized.message, stack: sanitized.stack }
              : { name: 'Error', message: sanitized.message },
          };
          send(envelope);
          this.logger.error(`Handler error for action ${action}`, { target });
        });
    } else {
      const envelope: ResponseEnvelope = {
        type: 'RESPONSE',
        id,
        status: 404,
        error: `No handler registered for action: ${action}`,
        errorPayload: {
          name: 'PeepsyNotFoundError',
          message: `No handler registered for action: ${action}`,
        },
      };
      send(envelope);
      this.logger.warn(`No handler for action: ${action}`, { target });
    }
  }

  private getChildForGroup(groupId: string): ChildProcessEntry | undefined {
    const group = this.groups.get(groupId);
    if (!group || group.targets.length === 0) {
      throw new PeepsyError(`Group ID "${groupId}" has no associated targets`);
    }

    const strategy = group.config.strategy ?? 'round-robin';
    const targets = group.targets.filter(target => {
      const entry = this.processes.get(target);
      return entry && !entry.stopping && !entry.disconnected && entry.child.connected;
    });
    if (targets.length === 0) return undefined;
    let targetIndex: number;

    switch (strategy) {
      case 'round-robin': {
        const counter = this.roundRobinCounters.get(groupId) ?? 0;
        targetIndex = counter % targets.length;
        this.roundRobinCounters.set(groupId, counter + 1);
        break;
      }

      case 'random': {
        targetIndex = Math.floor(Math.random() * targets.length);
        break;
      }

      case 'least-busy': {
        targetIndex = this.getLeastBusyProcessIndex(targets);
        break;
      }

      default:
        throw new PeepsyError(`Unknown load balancing strategy: ${strategy}`);
    }

    const target = targets[targetIndex];
    return target ? this.processes.get(target) : undefined;
  }

  private getLeastBusyProcessIndex(targets: string[]): number {
    let leastBusyIndex = 0;
    let minActiveRequests = Infinity;

    targets.forEach((target, index) => {
      const stats = this.processStats.get(target);
      if (stats && stats.requestsActive < minActiveRequests) {
        minActiveRequests = stats.requestsActive;
        leastBusyIndex = index;
      }
    });

    return leastBusyIndex;
  }

  private addToGroup(target: string, groupId: string, config: GroupConfig = {}): void {
    if (!this.groups.has(groupId)) {
      this.groups.set(groupId, { targets: [], config });
      this.roundRobinCounters.set(groupId, 0);
    }

    const group = this.groups.get(groupId)!;
    if (!group.targets.includes(target)) {
      group.targets.push(target);
      this.logger.debug(`Added target ${target} to group ${groupId}`);
    }
  }

  private initializeProcessStats(target: string): void {
    this.processStats.set(target, {
      requestsHandled: 0,
      requestsActive: 0,
      averageResponseTime: 0,
      lastActivity: Date.now(),
      errors: 0,
    });
  }

  private updateProcessStats(target: string | null, updates: Partial<ProcessStats>): void {
    if (!target) return;

    const stats = this.processStats.get(target);
    if (!stats) return;

    const updatedStats: ProcessStats = {
      requestsHandled: stats.requestsHandled + (updates.requestsHandled ?? 0),
      requestsActive: Math.max(0, stats.requestsActive + (updates.requestsActive ?? 0)),
      averageResponseTime:
        updates.averageResponseTime !== undefined
          ? this.applyEma(stats.averageResponseTime, updates.averageResponseTime)
          : stats.averageResponseTime,
      lastActivity: updates.lastActivity !== undefined ? updates.lastActivity : stats.lastActivity,
      errors: stats.errors + (updates.errors ?? 0),
    };

    // Preserve optional fields when not provided in updates
    if ((updates as any).status !== undefined) {
      (updatedStats as any).status = (updates as any).status;
    } else if ((stats as any).status !== undefined) {
      (updatedStats as any).status = (stats as any).status;
    }

    if ((updates as any).lastHeartbeatAt !== undefined) {
      (updatedStats as any).lastHeartbeatAt = (updates as any).lastHeartbeatAt;
    } else if ((stats as any).lastHeartbeatAt !== undefined) {
      (updatedStats as any).lastHeartbeatAt = (stats as any).lastHeartbeatAt;
    }

    this.processStats.set(target, updatedStats);
  }

  private applyEma(previous: number, sample: number, alpha: number = 0.2): number {
    if (previous === 0) return sample;
    return alpha * sample + (1 - alpha) * previous;
  }

  public configureGroup(groupId: string, config: GroupConfig): void {
    if (!this.groups.has(groupId)) {
      this.groups.set(groupId, { targets: [], config: { ...config } });
      this.roundRobinCounters.set(groupId, 0);
      return;
    }
    const group = this.groups.get(groupId)!;
    group.config = { ...group.config, ...config };
    this.logger.debug(`Configured group ${groupId}`, { config: group.config });
  }

  private getTargetFromChild(child: ChildProcess): string | null {
    for (const [target, entry] of this.processes) {
      if (entry.child === child) {
        return target;
      }
    }
    return null;
  }

  private cleanupProcess(target: string): void {
    this.processes.delete(target);
    this.processStats.delete(target);

    // Remove from groups
    for (const [groupId, group] of this.groups) {
      const index = group.targets.indexOf(target);
      if (index !== -1) {
        group.targets.splice(index, 1);
        if (group.targets.length === 0) {
          this.groups.delete(groupId);
          this.roundRobinCounters.delete(groupId);
        }
      }
    }
  }

  public async shutdownChild(target: string, timeout: number = 5000): Promise<void> {
    const processEntry = this.processes.get(target);
    if (!processEntry) {
      throw new PeepsyNotFoundError(target);
    }
    if (!isValidTimeout(timeout)) throw new PeepsyError('Invalid shutdown timeout');
    return this.stopProcess(target, processEntry, timeout);
  }

  public async terminateChild(target: string): Promise<void> {
    const entry = this.processes.get(target);
    if (!entry) throw new PeepsyNotFoundError(target);
    return this.stopProcess(target, entry, 0);
  }

  private stopProcess(
    target: string,
    entry: ChildProcessEntry,
    timeout: number,
    intentional = true
  ): Promise<void> {
    if (intentional) entry.stopping = true;
    this.rejectTargetRequests(target, entry);
    const existing = this.stoppingProcesses.get(entry);
    if (existing) {
      if (timeout === 0) existing.forceKill();
      return existing.promise;
    }
    const { child } = entry;
    let forceKill!: () => void;
    const stopped = new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let killed = false;
      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        child.removeListener('exit', onExit);
        child.removeListener('close', onExit);
      };
      const onExit = (): void => {
        cleanup();
        resolve();
      };
      forceKill = (): void => {
        if (killed) return;
        killed = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          cleanup();
          reject(new PeepsyProcessError('Termination was not confirmed within 2000ms', target));
        }, 2000);
        try {
          child.kill('SIGKILL');
        } catch {
          this.logger.error(`Failed to kill child: ${target}`);
        }
      };
      child.once('exit', onExit);
      child.once('close', onExit);
      timer = setTimeout(forceKill, timeout);
    });
    this.stoppingProcesses.set(entry, { promise: stopped, forceKill });
    void stopped.then(
      () => this.stoppingProcesses.delete(entry),
      () => this.stoppingProcesses.delete(entry)
    );
    if (timeout > 0 && child.connected) {
      try {
        child.send({ type: 'SHUTDOWN' }, error => {
          if (error) this.handleTransportFailure(target, entry);
        });
      } catch {
        this.handleTransportFailure(target, entry);
      }
    }
    return stopped;
  }

  public gracefulShutdown(timeout: number = 30000): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!isValidTimeout(timeout))
      return Promise.reject(new PeepsyError('Invalid shutdown timeout'));
    this.isShuttingDown = true;
    PeepsyMaster.signalMasters.delete(this);
    if (PeepsyMaster.signalMasters.size === 0) {
      process.removeListener('SIGINT', PeepsyMaster.signalHandler);
      process.removeListener('SIGTERM', PeepsyMaster.signalHandler);
    }
    if (this.healthMonitor) clearInterval(this.healthMonitor);
    this.healthMonitor = undefined;
    for (const groupId of this.groupQueues.keys()) this.rejectGroupQueue(groupId);
    this.shutdownPromise = Promise.resolve().then(async () => {
      const targets = [...this.processes.keys()];
      const results = await Promise.allSettled(
        targets.map(target =>
          this.shutdownChild(target, Math.max(1, Math.floor(timeout / Math.max(1, targets.length))))
        )
      );
      this.logger.info('Graceful shutdown completed');
      this.removeAllListeners();
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (failure) throw failure.reason;
    });
    return this.shutdownPromise;
  }

  // Public getters for monitoring
  public getProcessStats(target: string): ProcessStats | undefined {
    return this.processStats.get(target);
  }

  public getAllProcessStats(): Record<string, ProcessStats> {
    return Object.fromEntries(this.processStats);
  }

  public getUnhealthyProcesses(): string[] {
    const result: string[] = [];
    for (const [target, stats] of this.processStats) {
      if (stats.status === 'unhealthy') result.push(target);
    }
    return result;
  }

  public getGroupStats(groupId: string): GroupStats | undefined {
    const group = this.groups.get(groupId);
    if (!group) return undefined;

    const processes: Record<string, ProcessStats> = {};
    let totalRequests = 0;

    group.targets.forEach(target => {
      const stats = this.processStats.get(target);
      if (stats) {
        processes[target] = stats;
        totalRequests += stats.requestsHandled;
      }
    });

    return {
      processes,
      totalRequests,
      strategy: group.config.strategy ?? 'round-robin',
    };
  }

  public getActiveRequestsCount(): number {
    return this.activeRequests.size;
  }

  public isProcessAlive(target: string): boolean {
    const processEntry = this.processes.get(target);
    return processEntry?.child.connected ?? false;
  }

  private startHealthMonitor(): void {
    if (this.healthMonitor) return;
    this.healthMonitor = setInterval(() => {
      const now = Date.now();
      for (const [target, stats] of this.processStats) {
        const current = this.processes.get(target);
        if (!current || current.stopping || current.disconnected) continue;
        const last = stats.lastHeartbeatAt ?? stats.lastActivity;
        if (!last) continue;
        const missed = now - last > this.heartbeatIntervalMs * this.heartbeatMissThreshold;
        if (missed) {
          this.logger.warn(`Child ${target} missed heartbeats; marking unhealthy and restarting`);
          this.updateProcessStats(target, { status: 'unhealthy' });
          // attempt restart by killing and letting exit handler respawn
          const entry = this.processes.get(target);
          const groupId = entry?.groupId;
          const groupCfg = groupId ? this.groups.get(groupId)?.config : undefined;
          const disableAutoRestart = entry?.disableAutoRestart || groupCfg?.disableAutoRestart;
          try {
            if (!disableAutoRestart) {
              entry?.child.kill('SIGKILL');
              this.emit('heartbeat-missed', { target, timestamp: now });
            } else {
              this.logger.warn(`Auto-restart disabled for ${target}; not killing process`);
              this.emit('heartbeat-missed', { target, timestamp: now });
            }
          } catch {
            /* istanbul ignore next */
            this.logger.error(`Failed to kill unhealthy child ${target}`);
          }
        } else {
          this.updateProcessStats(target, { status: 'healthy' });
        }
      }
    }, this.heartbeatIntervalMs);
    if (this.healthMonitor.unref) {
      this.healthMonitor.unref();
    }
  }
}
