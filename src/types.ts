/**
 * Peepsy - A Node.js library for bidirectional, HTTP-like inter-process communication using promises
 *
 * @author Peepsy Contributors
 * @license MIT
 */

import { ChildProcess } from 'child_process';

export interface RequestMessage {
  readonly id: string;
  readonly action: string;
  readonly data?: unknown;
}

export interface ResponseMessage {
  readonly id: string;
  readonly status: number;
  readonly data?: unknown;
  readonly error?: string;
}

export interface ChildProcessEntry {
  readonly child: ChildProcess;
  readonly mode: ProcessMode;
}

export interface ProcessConfig {
  readonly timeout?: number;
  readonly maxRetries?: number;
  readonly retryDelay?: number;
}

export interface SpawnOptions {
  readonly execPath?: string;
  readonly silent?: boolean;
  readonly env?: Record<string, string>;
}

export interface GroupConfig {
  readonly strategy?: 'round-robin' | 'random' | 'least-busy';
  readonly maxConcurrency?: number;
}

export type ProcessMode = 'sequential' | 'concurrent';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface PeepsyLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface PeepsyOptions {
  readonly timeout?: number;
  readonly logger?: PeepsyLogger;
  readonly maxRetries?: number;
  readonly retryDelay?: number;
}

export interface QueueItem<T> {
  readonly item: T;
  readonly priority: number;
  readonly expiry: number;
  readonly timestamp: number;
}

export interface ProcessStats {
  readonly requestsHandled: number;
  readonly requestsActive: number;
  readonly averageResponseTime: number;
  readonly lastActivity: number;
  readonly errors: number;
}

export interface GroupStats {
  readonly processes: Record<string, ProcessStats>;
  readonly totalRequests: number;
  readonly strategy: string;
}

export interface PeepsyEvent {
  readonly type: 'request' | 'response' | 'error' | 'spawn' | 'shutdown';
  readonly timestamp: number;
  readonly target?: string;
  readonly group?: string;
  readonly error?: Error;
  readonly data?: unknown;
}

// Error classes
export class PeepsyError extends Error {
  public readonly code: string;
  public readonly timestamp: number;

  constructor(message: string, code: string = 'PEEPSY_ERROR') {
    super(message);
    this.name = 'PeepsyError';
    this.code = code;
    this.timestamp = Date.now();
  }
}

export class PeepsyTimeoutError extends PeepsyError {
  constructor(timeout: number, target?: string) {
    super(
      `Request timed out after ${timeout}ms${target ? ` for target: ${target}` : ''}`,
      'PEEPSY_TIMEOUT'
    );
    this.name = 'PeepsyTimeoutError';
  }
}

export class PeepsyProcessError extends PeepsyError {
  constructor(message: string, target?: string) {
    super(`Process error${target ? ` for target ${target}` : ''}: ${message}`, 'PEEPSY_PROCESS');
    this.name = 'PeepsyProcessError';
  }
}

export class PeepsyNotFoundError extends PeepsyError {
  constructor(target: string) {
    super(`No process found for target or group: ${target}`, 'PEEPSY_NOT_FOUND');
    this.name = 'PeepsyNotFoundError';
  }
}
