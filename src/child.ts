/**
 * PeepsyChild - Child process for handling requests and communication with master
 */

import { randomUUID } from 'crypto';
import {
  RequestMessage,
  ResponseMessage,
  ProcessMode,
  PeepsyOptions,
  PeepsyLogger,
  PeepsyError,
  PeepsyTimeoutError,
} from './types';
import { PriorityQueue, DefaultLogger, delay, isValidTimeout, sanitizeError } from './utils';

export class PeepsyChild {
  private readonly queue: PriorityQueue<RequestMessage> | null = null;
  private readonly activeRequests: Map<string, (response: ResponseMessage) => void> = new Map();
  private readonly handlers: Map<string, (data: unknown) => Promise<unknown> | unknown> = new Map();
  private readonly logger: PeepsyLogger;
  private readonly mode: ProcessMode;
  private readonly timeout: number;
  private isProcessing: boolean = false;
  private isShuttingDown: boolean = false;
  private queueCleanupInterval: ReturnType<typeof setInterval> | undefined = undefined;
  private requestsHandled: number = 0;
  private requestsInProgress: number = 0;

  constructor(mode: ProcessMode = 'sequential', options: PeepsyOptions = {}) {
    this.mode = mode;
    this.timeout = options.timeout ?? 5000;
    this.logger = options.logger ?? new DefaultLogger();

    if (!isValidTimeout(this.timeout)) {
      throw new PeepsyError('Invalid timeout value. Must be a positive integer <= 300000ms');
    }

    if (mode === 'sequential') {
      this.queue = new PriorityQueue();
      this.startQueueCleanup();
    }

    this.setupMessageHandlers();
    this.setupProcessHandlers();

    this.logger.debug(`PeepsyChild initialized in ${mode} mode`);
  }

  private setupMessageHandlers(): void {
    if (!process.send) {
      throw new PeepsyError('This Node.js script was not spawned with an IPC channel');
    }

    process.on('message', (message: any) => {
      try {
        if (this.isShuttingDown) return;

        if (message?.type === 'INIT') {
          this.logger.debug('Child process initialized', { mode: message.mode });
          return;
        }

        if (message?.type === 'REQUEST') {
          const { request, timeout } = message;
          if (this.mode === 'sequential') {
            this.enqueueRequest(request, timeout);
          } else {
            void this.processRequestImmediately(request);
          }
        } else if (message?.type === 'RESPONSE' && this.activeRequests.has(message.id)) {
          const resolve = this.activeRequests.get(message.id);
          if (resolve) {
            resolve(message);
            this.activeRequests.delete(message.id);
          }
        } else if (message?.type === 'SHUTDOWN') {
          void this.gracefulShutdown();
        }
      } catch (error) {
        this.logger.error('Error handling message from master', error);
      }
    });
  }

  private setupProcessHandlers(): void {
    const shutdown = (): void => {
      void this.gracefulShutdown();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('disconnect', shutdown);

    process.on('uncaughtException', (error: Error) => {
      this.logger.error('Uncaught exception in child process', error);
      void this.gracefulShutdown();
    });

    process.on('unhandledRejection', (reason: unknown) => {
      this.logger.error('Unhandled rejection in child process', reason);
    });
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
    data: unknown = {},
    options: { timeout?: number; retries?: number } = {}
  ): Promise<unknown> {
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
          await delay(1000); // 1 second retry delay
        }

        const response = await this.executeRequest(action, data, requestTimeout);

        if (attempt > 0) {
          this.logger.info(`Request succeeded on retry ${attempt}`, { action });
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Request attempt ${attempt + 1} failed`, {
          action,
          error: sanitizeError(error),
        });
      }
    }

    throw lastError ?? new PeepsyError('Request failed after retries');
  }

  private async executeRequest(action: string, data: unknown, timeout: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();

      const timeoutHandle = setTimeout(() => {
        this.activeRequests.delete(id);
        reject(new PeepsyTimeoutError(timeout));
      }, timeout);

      this.activeRequests.set(id, (response: ResponseMessage) => {
        clearTimeout(timeoutHandle);
        if (response.error) {
          reject(new PeepsyError(response.error));
        } else {
          resolve(response.data);
        }
      });

      if (!process.send) {
        clearTimeout(timeoutHandle);
        this.activeRequests.delete(id);
        reject(new PeepsyError('No IPC channel available'));
        return;
      }

      try {
        process.send({ type: 'REQUEST', id, action, data });
      } catch (error) {
        clearTimeout(timeoutHandle);
        this.activeRequests.delete(id);
        reject(error);
      }
    });
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
    } catch (error) {
      this.logger.error('Error processing queue', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processRequestImmediately(request: RequestMessage): Promise<void> {
    try {
      this.requestsInProgress++;
      await this.processRequest(request);
    } catch (error) {
      this.logger.error('Error processing immediate request', error);
    } finally {
      this.requestsInProgress--;
    }
  }

  private async processRequest(request: RequestMessage): Promise<void> {
    if (!process.send) {
      this.logger.error('No IPC channel available for response');
      return;
    }

    const { id, action, data } = request;
    const handler = this.handlers.get(action);

    if (!handler) {
      process.send({
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

      process.send({
        type: 'RESPONSE',
        id,
        status: 200,
        data: result,
      });

      this.requestsHandled++;
      this.logger.debug(`Request processed successfully`, {
        action,
        duration,
        requestsHandled: this.requestsHandled,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const sanitized = sanitizeError(error);

      process.send({
        type: 'RESPONSE',
        id,
        status: 500,
        error: sanitized.message,
      });

      this.logger.error(`Request processing failed`, {
        action,
        duration,
        error: sanitized,
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
    process.removeAllListeners('message');
    process.removeAllListeners('disconnect');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');

    this.logger.info(`Child process shutting down. Handled ${this.requestsHandled} requests.`);

    // Small delay to ensure logs are flushed
    await delay(100);

    process.exit(0);
  }

  // Public getters for monitoring
  public getRequestsHandled(): number {
    return this.requestsHandled;
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
