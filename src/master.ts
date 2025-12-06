/**
 * PeepsyMaster - Master process for managing child processes and communication
 */

import { ChildProcess, fork } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  RequestMessage,
  ResponseMessage,
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
} from './types';
import { DefaultLogger, delay, isValidTimeout, sanitizeError } from './utils';

export class PeepsyMaster extends EventEmitter {
  private readonly processes: Map<string, ChildProcessEntry> = new Map();
  private readonly groups: Map<string, { targets: string[]; config: GroupConfig }> = new Map();
  private readonly roundRobinCounters: Map<string, number> = new Map();
  private readonly activeRequests: Map<string, (response: ResponseMessage) => void> = new Map();
  private readonly handlers: Map<string, (data: unknown) => Promise<unknown> | unknown> = new Map();
  private readonly processStats: Map<string, ProcessStats> = new Map();
  private readonly logger: PeepsyLogger;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private isShuttingDown: boolean = false;

  constructor(options: PeepsyOptions = {}) {
    super();
    this.timeout = options.timeout ?? 5000;
    this.maxRetries = options.maxRetries ?? 0;
    this.retryDelay = options.retryDelay ?? 1000;
    this.logger = options.logger ?? new DefaultLogger();

    if (!isValidTimeout(this.timeout)) {
      throw new PeepsyError('Invalid timeout value. Must be a positive integer <= 300000ms');
    }

    // Set up cleanup on process termination
    process.on('SIGINT', () => this.gracefulShutdown());
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('beforeExit', () => this.gracefulShutdown());
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

    this.logger.debug(`Spawning child process: ${target}`, { scriptPath, mode, groupId, options });

    try {
      const forkOptions: any = {};
      if (options.execPath) forkOptions.execPath = options.execPath;
      if (options.silent !== undefined) forkOptions.silent = options.silent;
      if (options.env) forkOptions.env = { ...process.env, ...options.env };

      const child = fork(scriptPath, [], forkOptions);
      const processEntry: ChildProcessEntry = { child, mode };

      this.processes.set(target, processEntry);
      this.initializeProcessStats(target);

      if (groupId) {
        this.addToGroup(target, groupId);
      }

      this.setupChildEventHandlers(child, target);
      child.send({ type: 'INIT', mode });

      this.logger.info(`Child process spawned: ${target}`, { pid: child.pid });
      this.emit('spawn', { type: 'spawn', timestamp: Date.now(), target });
    } catch (error) {
      const errorMsg = `Failed to spawn child process: ${target}`;
      this.logger.error(errorMsg, error);
      throw new PeepsyProcessError(errorMsg, target);
    }
  }

  public registerHandler(
    action: string,
    handler: (data: unknown) => Promise<unknown> | unknown
  ): void {
    this.handlers.set(action, handler);
    this.logger.debug(`Handler registered for action: ${action}`);
  }

  public unregisterHandler(action: string): boolean {
    const removed = this.handlers.delete(action);
    if (removed) {
      this.logger.debug(`Handler unregistered for action: ${action}`);
    }
    return removed;
  }

  public async sendRequest(
    action: string,
    targetOrGroup: string,
    data: unknown = {},
    options: { timeout?: number; retries?: number } = {}
  ): Promise<ResponseMessage> {
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

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Request attempt ${attempt + 1} failed`, {
          action,
          targetOrGroup,
          error: sanitizeError(error),
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
      let processEntry: ChildProcessEntry | undefined;

      try {
        if (this.groups.has(targetOrGroup)) {
          processEntry = this.getChildForGroup(targetOrGroup);
        } else {
          processEntry = this.processes.get(targetOrGroup);
        }

        if (!processEntry) {
          return reject(new PeepsyNotFoundError(targetOrGroup));
        }

        const { child } = processEntry;
        const id = randomUUID();
        const request: RequestMessage = { id, action, data };

        const timeoutHandle = setTimeout(() => {
          this.activeRequests.delete(id);
          this.updateProcessStats(this.getTargetFromChild(child), { errors: 1 });
          reject(new PeepsyTimeoutError(timeout, targetOrGroup));
        }, timeout);

        this.activeRequests.set(id, (response: ResponseMessage) => {
          clearTimeout(timeoutHandle);
          this.updateProcessStats(this.getTargetFromChild(child), {
            requestsHandled: 1,
            averageResponseTime: Date.now() - startTime,
          });

          if (response.status >= 400) {
            this.updateProcessStats(this.getTargetFromChild(child), { errors: 1 });
            reject(
              new PeepsyError(response.error ?? `Request failed with status ${response.status}`)
            );
          } else {
            resolve(response);
          }
        });

        const startTime = Date.now();
        this.updateProcessStats(this.getTargetFromChild(child), { requestsActive: 1 });

        child.send({ type: 'REQUEST', request, timeout });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private setupChildEventHandlers(child: ChildProcess, target: string): void {
    child.on('message', (message: any) => {
      try {
        if (message?.type === 'REQUEST') {
          this.handleChildRequest(message, child);
        } else if (message?.type === 'RESPONSE' && this.activeRequests.has(message.id)) {
          const resolve = this.activeRequests.get(message.id);
          if (resolve) {
            resolve(message);
            this.activeRequests.delete(message.id);
            this.updateProcessStats(target, { requestsActive: -1 });
          }
        }
      } catch (error) {
        this.logger.error(`Error handling message from child ${target}`, error);
      }
    });

    child.on('error', (error: Error) => {
      this.logger.error(`Child process error: ${target}`, error);
      this.updateProcessStats(target, { errors: 1 });
      this.emit('error', {
        type: 'error',
        timestamp: Date.now(),
        target,
        error,
      });
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      this.logger.info(`Child process exited: ${target}`, { code, signal, pid: child.pid });
      this.cleanupProcess(target);
    });

    child.on('disconnect', () => {
      this.logger.debug(`Child process disconnected: ${target}`);
    });
  }

  private handleChildRequest(message: any, child: ChildProcess): void {
    const { id, action, data } = message;
    const target = this.getTargetFromChild(child);

    if (this.handlers.has(action)) {
      const handler = this.handlers.get(action)!;
      Promise.resolve(handler(data))
        .then(response => {
          child.send({ type: 'RESPONSE', id, status: 200, data: response });
        })
        .catch(error => {
          const sanitized = sanitizeError(error);
          child.send({
            type: 'RESPONSE',
            id,
            status: 500,
            error: sanitized.message,
          });
          this.logger.error(`Handler error for action ${action}`, sanitized);
        });
    } else {
      child.send({
        type: 'RESPONSE',
        id,
        status: 404,
        error: `No handler registered for action: ${action}`,
      });
      this.logger.warn(`No handler for action: ${action}`, { target });
    }
  }

  private getChildForGroup(groupId: string): ChildProcessEntry | undefined {
    const group = this.groups.get(groupId);
    if (!group || group.targets.length === 0) {
      throw new PeepsyError(`Group ID "${groupId}" has no associated targets`);
    }

    const strategy = group.config.strategy ?? 'round-robin';
    let targetIndex: number;

    switch (strategy) {
      case 'round-robin':
        const counter = this.roundRobinCounters.get(groupId) ?? 0;
        targetIndex = counter % group.targets.length;
        this.roundRobinCounters.set(groupId, counter + 1);
        break;

      case 'random':
        targetIndex = Math.floor(Math.random() * group.targets.length);
        break;

      case 'least-busy': {
        targetIndex = this.getLeastBusyProcessIndex(group.targets);
        break;
      }

      default:
        throw new PeepsyError(`Unknown load balancing strategy: ${strategy}`);
    }

    const target = group.targets[targetIndex];
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
      averageResponseTime: updates.averageResponseTime ?? stats.averageResponseTime,
      lastActivity: Date.now(),
      errors: stats.errors + (updates.errors ?? 0),
    };

    this.processStats.set(target, updatedStats);
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

    return new Promise((resolve, reject) => {
      const { child } = processEntry;
      let childExited = false;

      const cleanup = (): void => {
        child.removeAllListeners();
        this.cleanupProcess(target);
      };

      const onExit = (): void => {
        if (childExited) return;
        childExited = true;
        cleanup();
        resolve();
      };

      const onError = (err: Error): void => {
        if (childExited) return;
        childExited = true;
        cleanup();
        reject(err);
      };

      child.once('exit', onExit);
      child.once('error', onError);

      // Try graceful shutdown first
      if (child.connected) {
        try {
          child.send({ type: 'SHUTDOWN' });
        } catch (error) {
          this.logger.warn(`Failed to send shutdown message to ${target}`, error);
        }
      }

      // Force kill after timeout
      const killTimeout = setTimeout(() => {
        if (!childExited) {
          this.logger.warn(`Force killing child process ${target} after timeout`);
          try {
            child.kill('SIGKILL');
          } catch (error) {
            this.logger.error(`Failed to kill child process ${target}`, error);
          }
        }
      }, timeout);

      child.once('exit', () => clearTimeout(killTimeout));
    });
  }

  public async gracefulShutdown(timeout: number = 30000): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    this.logger.info('Starting graceful shutdown...');

    const targets = Array.from(this.processes.keys());
    const shutdownPromises = targets.map(target =>
      this.shutdownChild(target, timeout / targets.length).catch(error =>
        this.logger.error(`Failed to shutdown child ${target}`, error)
      )
    );

    try {
      await Promise.allSettled(shutdownPromises);
      this.logger.info('Graceful shutdown completed');
    } catch (error) {
      this.logger.error('Error during graceful shutdown', error);
    }

    this.removeAllListeners();
  }

  // Public getters for monitoring
  public getProcessStats(target: string): ProcessStats | undefined {
    return this.processStats.get(target);
  }

  public getAllProcessStats(): Record<string, ProcessStats> {
    return Object.fromEntries(this.processStats);
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
}
