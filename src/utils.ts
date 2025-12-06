/**
 * Utility classes and functions for Peepsy
 */

import { QueueItem, PeepsyLogger, LogLevel } from './types';

export class PriorityQueue<T> {
  private queue: Array<QueueItem<T>> = [];

  public enqueue(item: T, priority: number = 0, timeout: number = 5000): void {
    const expiry = Date.now() + timeout;
    const timestamp = Date.now();
    this.queue.push({ item, priority, expiry, timestamp });
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  public dequeue(): T | null {
    while (this.queue.length > 0) {
      const queueItem = this.queue.shift();
      if (queueItem && Date.now() < queueItem.expiry) {
        return queueItem.item;
      }
    }
    return null;
  }

  public isEmpty(): boolean {
    return this.queue.length === 0;
  }

  public size(): number {
    return this.queue.length;
  }

  public cleanExpiredMessages(): number {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter(({ expiry }) => Date.now() < expiry);
    return initialLength - this.queue.length;
  }

  public clear(): void {
    this.queue = [];
  }

  public peek(): T | null {
    if (this.queue.length === 0) {
      return null;
    }

    // Find the first non-expired item
    while (this.queue.length > 0) {
      const queueItem = this.queue[0];
      if (queueItem && Date.now() < queueItem.expiry) {
        return queueItem.item;
      }
      this.queue.shift(); // Remove expired item
    }

    return null;
  }
}

export class DefaultLogger implements PeepsyLogger {
  constructor(private readonly level: LogLevel = 'info') {}

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[level] >= levels[this.level];
  }

  private formatMessage(level: string, message: string, args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const argsStr =
      args.length > 0
        ? ` ${args
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
            .join(' ')}`
        : '';
    return `[${timestamp}] [${level.toUpperCase()}] [Peepsy] ${message}${argsStr}`;
  }

  public debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, args));
    }
  }

  public info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, args));
    }
  }

  public warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, args));
    }
  }

  public error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, args));
    }
  }
}

export class NoOpLogger implements PeepsyLogger {
  public debug(): void {
    // No-op
  }

  public info(): void {
    // No-op
  }

  public warn(): void {
    // No-op
  }

  public error(): void {
    // No-op
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function isValidTimeout(timeout: number): boolean {
  return Number.isInteger(timeout) && timeout > 0 && timeout <= 300000; // Max 5 minutes
}

export function sanitizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    const result: { message: string; stack?: string } = {
      message: error.message,
    };
    if (error.stack) {
      result.stack = error.stack;
    }
    return result;
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  return { message: 'Unknown error occurred' };
}
