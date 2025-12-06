/**
 * Peepsy - A Node.js library for bidirectional, HTTP-like inter-process communication using promises
 *
 * @author Outburn Ltd.
 * @license MIT
 */

export { PeepsyMaster } from './master';
export { PeepsyChild } from './child';

export {
  // Types
  RequestMessage,
  ResponseMessage,
  ChildProcessEntry,
  ProcessConfig,
  SpawnOptions,
  GroupConfig,
  ProcessMode,
  LogLevel,
  PeepsyLogger,
  PeepsyOptions,
  QueueItem,
  ProcessStats,
  GroupStats,
  PeepsyEvent,

  // Error classes
  PeepsyError,
  PeepsyTimeoutError,
  PeepsyProcessError,
  PeepsyNotFoundError,
} from './types';

export {
  // Utilities
  PriorityQueue,
  DefaultLogger,
  NoOpLogger,
  delay,
  generateId,
  isValidTimeout,
  sanitizeError,
} from './utils';

// Version info (auto-generated during build)
export { VERSION } from './version';
