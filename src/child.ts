/**
 * PeepsyChild - Child process for handling requests and communication with master
 */

import { randomUUID } from 'crypto';
import {
  RequestMessage,
  ResponseMessage,
  RequestEnvelope,
  ResponseEnvelope,
  ProcessMode,
  PeepsyOptions,
  PeepsyLogger,
  PeepsyError,
  PeepsyTimeoutError,
  PeepsyProcessError,
} from './types';
import { PriorityQueue, DefaultLogger, delay, isValidTimeout, sanitizeError } from './utils';

export class PeepsyChild {
  private readonly queue: PriorityQueue<RequestMessage> | null = null;
  private readonly activeRequests = new Map<
    string,
    {
      timer: ReturnType<typeof setTimeout>;
      resolve: (response: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly handlers: Map<string, (data: unknown) => Promise<unknown> | unknown> = new Map();
  private readonly logger: PeepsyLogger;
  private readonly mode: ProcessMode;
  private readonly timeout: number;
  private readonly retryDelay: number;
  private readonly maxConcurrency: number | undefined;
  private readonly heartbeatIntervalMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined = undefined;
  private isProcessing: boolean = false;
  private isShuttingDown: boolean = false;
  private queueCleanupInterval: ReturnType<typeof setInterval> | undefined = undefined;
  private requestsHandled: number = 0;
  private requestsInProgress: number = 0;
  private readonly processListeners: Array<[string, (...args: any[]) => void]> = [];

  constructor(mode: ProcessMode = 'sequential', options: PeepsyOptions = {}) {
    this.mode = mode;
    this.timeout = options.timeout ?? 5000;
    this.logger = options.logger ?? new DefaultLogger();
    this.retryDelay = options.retryDelay ?? 1000;
    this.maxConcurrency = options.maxConcurrency;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 2000;

    if (!isValidTimeout(this.timeout)) {
      throw new PeepsyError('Invalid timeout value. Must be a positive integer <= 300000ms');
    }
    if (!process.send)
      throw new PeepsyError('This Node.js script was not spawned with an IPC channel');

    if (
      mode === 'sequential' ||
      (mode === 'concurrent' &&
        typeof options.maxConcurrency === 'number' &&
        options.maxConcurrency > 0)
    ) {
      this.queue = new PriorityQueue();
      this.startQueueCleanup();
    }

    this.setupMessageHandlers();
    this.setupProcessHandlers(options.handleSignals !== false);
    this.startHeartbeat();

    this.logger.debug(`PeepsyChild initialized in ${mode} mode`);
  }

  private setupMessageHandlers(): void {
    if (!process.send) {
      throw new PeepsyError('This Node.js script was not spawned with an IPC channel');
    }

    this.addProcessListener('message', (message: any) => {
      try {
        if (this.isShuttingDown) return;

        if (message?.type === 'INIT') {
          this.logger.debug('Child process initialized', { mode: message.mode });
          return;
        }

        if (message?.type === 'REQUEST') {
          // Backward-compatible shape: either flat envelope or nested { request, timeout }
          const envelope = message as Partial<RequestEnvelope> & {
            request?: RequestMessage;
            timeout?: number;
          };
          const req: RequestMessage = envelope.request
            ? envelope.request
            : { id: envelope.id as string, action: envelope.action as string, data: envelope.data };
          const to = envelope.timeout ?? this.timeout;
          if (this.mode === 'sequential') {
            this.enqueueRequest(req, to);
          } else if (
            this.queue &&
            typeof this.maxConcurrency === 'number' &&
            this.maxConcurrency > 0
          ) {
            this.enqueueRequest(req, to);
            void this.processQueueWithConcurrency();
          } else {
            void this.processRequestImmediately(req);
          }
        } else if (message?.type === 'RESPONSE' && this.activeRequests.has(message.id)) {
          this.settleRequest(message.id, message);
        } else if (message?.type === 'SHUTDOWN') {
          void this.gracefulShutdown();
        }
      } catch {
        this.logger.error('Error handling message from master');
      }
    });
  }

  private addProcessListener(event: string, listener: (...args: any[]) => void): void {
    this.processListeners.push([event, listener]);
    process.on(event, listener);
  }

  private setupProcessHandlers(handleSignals: boolean): void {
    const shutdown = (): void => {
      void this.gracefulShutdown();
    };

    if (handleSignals) {
      this.addProcessListener('SIGINT', shutdown);
      this.addProcessListener('SIGTERM', shutdown);
    }
    this.addProcessListener('disconnect', shutdown);

    this.addProcessListener('uncaughtException', () => {
      this.logger.error('Uncaught exception in child process');
      void this.gracefulShutdown();
    });

    this.addProcessListener('unhandledRejection', () => {
      this.logger.error('Unhandled rejection in child process');
    });
  }

  private startHeartbeat(): void {
    if (!process.send) return;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      try {
        const sendFn = process.send;
        if (sendFn && process.connected !== false && !this.isShuttingDown) {
          sendFn(
            {
              type: 'HEARTBEAT',
              pid: process.pid,
              timestamp: Date.now(),
              requestsActive: this.requestsInProgress,
            } as any,
            undefined,
            undefined,
            () => undefined
          );
        }
      } catch (err) {
        void err;
      }
    }, this.heartbeatIntervalMs);
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
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

  public async sendRequest<TReq = unknown, TRes = unknown>(
    action: string,
    data: TReq = {} as TReq,
    options: { timeout?: number; retries?: number } = {}
  ): Promise<TRes> {
    if (this.isShuttingDown) {
      throw new PeepsyError('Cannot send request during shutdown');
    }

    const requestTimeout = options.timeout ?? this.timeout;
    const maxRetries = options.retries ?? 0;

    if (!isValidTimeout(requestTimeout)) {
      throw new PeepsyError('Invalid timeout value');
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.debug(`Retry attempt ${attempt}/${maxRetries} for ${action}`);
          await delay(this.retryDelay);
        }

        const response = await this.executeRequest(action, data, requestTimeout);

        if (attempt > 0) {
          this.logger.info(`Request succeeded on retry ${attempt}`, { action });
        }

        return response as TRes;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Request attempt ${attempt + 1} failed`, {
          action,
          code: error instanceof PeepsyError ? error.code : 'PEEPSY_PROCESS',
        });
      }
    }

    throw lastError ?? new PeepsyError('Request failed after retries');
  }

  private async executeRequest(action: string, data: unknown, timeout: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.isShuttingDown || !process.send || process.connected === false) {
        reject(new PeepsyProcessError('No IPC channel available'));
        return;
      }
      const id = randomUUID();

      const timeoutHandle = setTimeout(() => {
        this.settleRequest(id, undefined, new PeepsyTimeoutError(timeout));
      }, timeout);

      this.activeRequests.set(id, { timer: timeoutHandle, resolve, reject });

      try {
        const envelope: RequestEnvelope = { type: 'REQUEST', id, action, data, timeout };
        process.send(envelope, undefined, undefined, error => {
          if (error) this.settleRequest(id, undefined, error);
        });
      } catch (error) {
        this.settleRequest(
          id,
          undefined,
          error instanceof Error ? error : new PeepsyProcessError('IPC send failed')
        );
      }
    });
  }

  private settleRequest(id: string, response?: ResponseMessage, error?: Error): void {
    const pending = this.activeRequests.get(id);
    if (!pending) return;
    this.activeRequests.delete(id);
    clearTimeout(pending.timer);
    const failure =
      error ??
      (response && (response.error || response.status >= 400)
        ? new PeepsyError(response.error ?? `Request failed with status ${response.status}`)
        : undefined);
    if (failure) pending.reject(failure);
    else pending.resolve(response?.data);
  }

  private sendResponse(envelope: ResponseEnvelope): void {
    if (!process.send || process.connected === false || this.isShuttingDown) return;
    try {
      process.send(envelope, undefined, undefined, error => {
        if (error) this.logger.warn('IPC response send failed');
      });
    } catch {
      this.logger.warn('IPC response send failed');
    }
  }

  private enqueueRequest(request: RequestMessage, timeout: number): void {
    if (!this.queue) {
      this.logger.error('Queue not available in concurrent mode');
      return;
    }

    this.queue.enqueue(request, 0, timeout);
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || !this.queue?.peek() || this.isShuttingDown) {
      return;
    }

    this.isProcessing = true;

    try {
      while (!this.queue.isEmpty() && !this.isShuttingDown) {
        const request = this.queue.dequeue();
        if (request) {
          await this.processRequest(request);
        }
      }
    } catch {
      this.logger.error('Error processing queue');
    } finally {
      this.isProcessing = false;
    }
  }

  private async processQueueWithConcurrency(): Promise<void> {
    if (this.isShuttingDown || !this.queue) return;
    while (
      !this.queue.isEmpty() &&
      this.requestsInProgress < (this.maxConcurrency ?? Number.MAX_SAFE_INTEGER)
    ) {
      const request = this.queue.dequeue();
      if (request) {
        void this.processRequestImmediately(request);
      }
    }
  }

  private async processRequestImmediately(request: RequestMessage): Promise<void> {
    try {
      this.requestsInProgress++;
      await this.processRequest(request);
    } catch {
      this.logger.error('Error processing immediate request');
    } finally {
      this.requestsInProgress--;
    }
  }

  private async processRequest(request: RequestMessage): Promise<void> {
    if (!process.send || process.connected === false || this.isShuttingDown) {
      this.logger.error('No IPC channel available for response');
      return;
    }

    const { id, action, data } = request;
    const handler = this.handlers.get(action);

    if (!handler) {
      this.sendResponse({
        type: 'RESPONSE',
        id,
        status: 404,
        error: `No handler registered for action: ${action}`,
      });
      return;
    }

    const startTime = Date.now();

    try {
      const result = await Promise.resolve(handler(data));
      const duration = Date.now() - startTime;

      const env: ResponseEnvelope = { type: 'RESPONSE', id, status: 200, data: result };
      this.sendResponse(env);

      this.requestsHandled++;
      this.logger.debug(`Request processed successfully`, {
        action,
        duration,
        requestsHandled: this.requestsHandled,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const sanitized = sanitizeError(error);

      const env: ResponseEnvelope = {
        type: 'RESPONSE',
        id,
        status: 500,
        error: sanitized.message,
      };
      this.sendResponse(env);

      this.logger.error(`Request processing failed`, {
        action,
        duration,
      });
    }
  }

  private startQueueCleanup(): void {
    if (this.queue) {
      this.queueCleanupInterval = setInterval(() => {
        if (this.queue && !this.isShuttingDown) {
          const cleaned = this.queue.cleanExpiredMessages();
          if (cleaned > 0) {
            this.logger.debug(`Cleaned ${cleaned} expired messages from queue`);
          }
        }
      }, 5000); // Clean every 5 seconds
      if (this.queueCleanupInterval.unref) {
        this.queueCleanupInterval.unref();
      }
    }
  }

  private stopQueueCleanup(): void {
    if (this.queueCleanupInterval) {
      clearInterval(this.queueCleanupInterval);
      this.queueCleanupInterval = undefined;
    }
  }

  private async gracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    for (const id of this.activeRequests.keys()) {
      this.settleRequest(id, undefined, new PeepsyProcessError('IPC process shutting down'));
    }
    this.logger.info('Starting graceful shutdown...');

    // Stop accepting new requests
    this.stopQueueCleanup();

    // Wait for in-progress requests to complete (with timeout)
    const shutdownTimeout = 10000; // 10 seconds
    const startTime = Date.now();

    while (this.requestsInProgress > 0 && Date.now() - startTime < shutdownTimeout) {
      this.logger.debug(`Waiting for ${this.requestsInProgress} requests to complete...`);
      await delay(100);
    }

    if (this.requestsInProgress > 0) {
      this.logger.warn(
        `Forced shutdown with ${this.requestsInProgress} requests still in progress`
      );
    }

    // Clear remaining queue items
    this.queue?.clear();

    // Clean up listeners
    for (const [event, listener] of this.processListeners) process.removeListener(event, listener);
    this.processListeners.length = 0;

    this.logger.info(`Child process shutting down. Handled ${this.requestsHandled} requests.`);

    // Small delay to ensure logs are flushed
    await delay(100);
    this.stopHeartbeat();

    // Avoid hard exiting; disconnect IPC and let process exit naturally
    try {
      if (typeof process.disconnect === 'function') {
        process.disconnect();
      }
      // Hint exit code without forcing termination
      process.exitCode = 0;
    } catch (err) {
      /* istanbul ignore next */
      void err;
    }
  }

  // Public getters for monitoring
  public getRequestsHandled(): number {
    return this.requestsHandled;
  }

  public getActiveRequestsCount(): number {
    return this.activeRequests.size;
  }

  public getRequestsInProgress(): number {
    return this.requestsInProgress;
  }

  public getQueueSize(): number {
    return this.queue?.size() ?? 0;
  }

  public getMode(): ProcessMode {
    return this.mode;
  }

  public isActive(): boolean {
    return !this.isShuttingDown;
  }

  public getHandlerCount(): number {
    return this.handlers.size;
  }

  public getHandlerActions(): string[] {
    return Array.from(this.handlers.keys());
  }
}
