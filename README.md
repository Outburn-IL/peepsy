# Peepsy

[![npm version](https://badge.fury.io/js/peepsy.svg)](https://badge.fury.io/js/peepsy)
[![CI](https://github.com/Outburn-IL/peepsy/workflows/CI%2FCD/badge.svg)](https://github.com/Outburn-IL/peepsy/actions)
[![Coverage Status](https://codecov.io/gh/Outburn-IL/peepsy/branch/main/graph/badge.svg)](https://codecov.io/gh/Outburn-IL/peepsy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Peepsy** (pronounced *peep-see*) is a powerful Node.js library for **bidirectional, HTTP-like inter-process communication** using promises. The name is a phonetic spelling of **PIPC** (*Promisified Inter Process Communication*).

Peepsy simplifies complex multi-process architectures by providing a clean, promise-based API for communication between master and child processes, with advanced features like load balancing, priority queues, automatic retries, and comprehensive monitoring.

## ✨ Features

- 🔄 **Bidirectional Communication**: Both master and child processes can initiate requests
- ⚡ **Sequential & Concurrent Processing**: Choose the right processing mode for each worker
- 🎯 **Load Balancing**: Distribute requests across worker groups using round-robin, random, or least-busy strategies
- 🔁 **Automatic Retries**: Built-in retry mechanism with configurable delays
- ⏱️ **Timeout Handling**: Automatic cleanup of timed-out requests
- 📊 **Real-time Monitoring**: Track performance metrics and process statistics
- 🛡️ **Error Recovery**: Robust error handling with custom error types
- 🔧 **TypeScript Support**: Full type definitions included
- 📋 **Priority Queues**: Handle requests with different priorities
- 🔒 **Graceful Shutdown**: Clean process termination with proper resource cleanup
 - ❤️ **Heartbeats + Auto-Restart**: Children emit heartbeats; master detects missed beats and can auto-restart
 - 🧯 **Strict Master-Side Queuing**: Group `maxConcurrency` enforced via queue, dispatches up to capacity
 - 🧭 **Structured Errors (Optional)**: Responses may include `errorPayload` alongside legacy `error` string
 - 🩺 **Health Helpers + Events**: Expose `getUnhealthyProcesses()` and emit `heartbeat-missed`/`auto-restart`
 - ⚙️ **Restart Toggles**: Disable auto-restart per group or per target for controlled recovery

## 📦 Installation

```bash
npm install peepsy
```

**Requirements**: Node.js 18.0.0 or higher

Note on heartbeat compatibility:
- Heartbeat relies on Node's IPC (`process.send`) from `child_process.fork` and timer `unref()` behavior.
- Use Node 18+ for consistent heartbeat timing and clean teardown semantics.
- Ensure workers are spawned via `fork` (with an IPC channel); without IPC, heartbeats cannot be delivered.

## 🚀 Quick Start

### Basic Master-Child Communication

#### Master Process (`master.js`)

```javascript
import { PeepsyMaster } from 'peepsy';

const master = new PeepsyMaster({ timeout: 5000 });

// Spawn worker processes
master.spawnChild('worker1', './worker.js', 'sequential');
master.spawnChild('worker2', './worker.js', 'concurrent', 'worker-group');
master.spawnChild('worker3', './worker.js', 'concurrent', 'worker-group');

// Register handler for child-initiated requests
master.registerHandler('getMasterInfo', async (data) => {
  return { 
    masterPid: process.pid,
    timestamp: Date.now(),
    requestData: data 
  };
});

// Send requests to workers
async function example() {
  try {
    // Request to specific worker
    const response1 = await master.sendRequest('processTask', 'worker1', { 
      task: 'analyze-data',
      data: [1, 2, 3, 4, 5] 
    });
    
    // Request to worker group (load balanced)
    const response2 = await master.sendRequest('computeHash', 'worker-group', {
      algorithm: 'sha256',
      input: 'hello world'
    });
    
    console.log('Results:', { response1, response2 });
  } catch (error) {
    console.error('Request failed:', error);
  }
}

example();
```

#### Worker Process (`worker.js`)

```javascript
import { PeepsyChild } from 'peepsy';

const worker = new PeepsyChild('sequential'); // or 'concurrent'

// Register request handlers
worker.registerHandler('processTask', async (data) => {
  const { task, data: input } = data;
  
  if (task === 'analyze-data') {
    const sum = input.reduce((a, b) => a + b, 0);
    const avg = sum / input.length;
    return { sum, average: avg, count: input.length };
  }
  
  throw new Error(`Unknown task: ${task}`);
});

worker.registerHandler('computeHash', async (data) => {
  const crypto = require('crypto');
  const { algorithm, input } = data;
  
  const hash = crypto.createHash(algorithm).update(input).digest('hex');
  return { algorithm, input, hash };
});

// Worker can also send requests to master
async function requestMasterInfo() {
  try {
    const info = await worker.sendRequest('getMasterInfo', { 
      workerPid: process.pid 
    });
    console.log('Master info:', info);
  } catch (error) {
    console.error('Failed to get master info:', error);
  }
}

// Call master periodically
setInterval(requestMasterInfo, 30000);

// Optional: limit concurrency in concurrent mode
// const worker = new PeepsyChild('concurrent', { maxConcurrency: 32 });
// Excess requests are queued and drained up to the cap.
```

## 🔧 Advanced Usage

### Usage: Heartbeat and Auto-Restart

```javascript
import { PeepsyMaster } from 'peepsy';

// Configure master with heartbeat monitoring
const master = new PeepsyMaster({
  heartbeatIntervalMs: 2000,        // child sends HEARTBEAT every 2s
  heartbeatMissThreshold: 3         // mark unhealthy if > ~6s without heartbeat
});

// Node version guidance:
// - Node 18+ required for stable timer/IPC semantics.
// - Heartbeat requires IPC (child must be spawned with `fork`).

// Spawn children; associate to a group to apply group-level toggles
master.spawnChild('w1', './worker.js', 'concurrent', 'api');
master.spawnChild('w2', './worker.js', 'concurrent', 'api');

// Optionally disable auto-restart per group
master.configureGroup('api', { disableAutoRestart: false, maxConcurrency: 8 });

// Listen to health events
master.on('heartbeat-missed', ({ target, timestamp }) => {
  console.warn(`[health] missed heartbeat from ${target} at ${new Date(timestamp).toISOString()}`);
});
master.on('auto-restart', ({ target, code, signal }) => {
  console.warn(`[health] attempting auto-restart of ${target} (code=${code}, signal=${signal})`);
});

// Query health status
const unhealthy = master.getUnhealthyProcesses();
if (unhealthy.length) {
  console.log('Unhealthy processes:', unhealthy);
}

// Per-target toggle is supported via spawn metadata (group toggle shown above)
// Auto-restart is disabled if group or target sets disableAutoRestart: true.
```

### Load Balancing Strategies

```javascript
import { PeepsyMaster } from 'peepsy';

const master = new PeepsyMaster();

// Create workers with different strategies
master.spawnChild('worker1', './worker.js', 'concurrent', 'api-group');
master.spawnChild('worker2', './worker.js', 'concurrent', 'api-group');
master.spawnChild('worker3', './worker.js', 'concurrent', 'api-group');

// Configure group strategy (round-robin is default)
master.configureGroup('api-group', { 
  strategy: 'least-busy',  // 'round-robin', 'random', or 'least-busy'
  maxConcurrency: 10       // cap total concurrent in-flight requests in the group
});

// Requests are automatically distributed
for (let i = 0; i < 100; i++) {
  master.sendRequest('processRequest', 'api-group', { requestId: i });
}

// Guidance:
// - Use group maxConcurrency to cap total in-flight requests across targets.
// - Use child maxConcurrency in 'concurrent' mode to cap per-process concurrency.
```

### Error Handling and Retries

```javascript
const master = new PeepsyMaster({
  timeout: 5000,
  maxRetries: 3,
  retryDelay: 1000
});

try {
  const result = await master.sendRequest(
    'unreliableTask', 
    'worker1',
    { data: 'test' },
    { 
      timeout: 10000,  // Override default timeout
      retries: 5        // Override default retry count
    }
  );
} catch (error) {
  if (error instanceof PeepsyTimeoutError) {
    console.log('Request timed out');
  } else if (error instanceof PeepsyNotFoundError) {
    console.log('Worker not found');
  } else {
    console.log('Other error:', error.message);
  }
}

// Structured error payloads (optional)
// In addition to the legacy `error` string, responses may include
// `errorPayload: { name, message, code?, stack? }` for richer diagnostics.
// This remains backward-compatible with existing handlers/tests.
```

### Typed API Examples

```typescript
import { PeepsyMaster, PeepsyChild } from 'peepsy';

// Master: typed sendRequest + handler
const master = new PeepsyMaster();
master.registerHandler<{ id: string }, { exists: boolean }>('check', async (data) => {
  return { exists: Boolean(data.id) };
});

const res = await master.sendRequest<{ a: number; b: number }, { result: number }>(
  'add',
  'worker1',
  { a: 1, b: 2 }
);
console.log(res.status, res.data?.result);

// Child: typed sendRequest + handler
const child = new PeepsyChild('sequential');
child.registerHandler<{ task: string }, { done: boolean }>('doTask', async (data) => {
  // ...
  return { done: true };
});

const info = await child.sendRequest<{ who: string }, { ok: boolean }>('getMasterInfo', {
  who: 'worker',
});
```

### Process Monitoring

```javascript
// Get individual process statistics
const stats = master.getProcessStats('worker1');
console.log('Worker stats:', {
  requestsHandled: stats.requestsHandled,
  requestsActive: stats.requestsActive,
  averageResponseTime: stats.averageResponseTime, // EMA smoothed
  errors: stats.errors
});

// Get group statistics
const groupStats = master.getGroupStats('worker-group');
console.log('Group stats:', {
  totalRequests: groupStats.totalRequests,
  strategy: groupStats.strategy,
  processes: Object.keys(groupStats.processes)
});

// Monitor active requests
console.log('Active requests:', master.getActiveRequestsCount());

// Check if process is alive
if (master.isProcessAlive('worker1')) {
  console.log('Worker1 is running');
}

// Heartbeats and auto-restart
// Children emit HEARTBEAT messages periodically (configurable via PeepsyOptions):
// { heartbeatIntervalMs, heartbeatMissThreshold }
// If a child misses heartbeats beyond the threshold, master marks it unhealthy
// and attempts an auto-restart using the original spawn configuration.
// You can disable auto-restart per group or per target.

// Events
master.on('heartbeat-missed', ({ target, timestamp }) => {
  // handle missed heartbeat
});
master.on('auto-restart', ({ target, code, signal }) => {
  // observe auto-restart attempts
});
```

### Custom Logging

```javascript
import { PeepsyMaster, DefaultLogger } from 'peepsy';

// Create custom logger
class CustomLogger {
  debug(message, ...args) { /* custom debug logging */ }
  info(message, ...args) { /* custom info logging */ }
  warn(message, ...args) { /* custom warn logging */ }
  error(message, ...args) { /* custom error logging */ }
}

const master = new PeepsyMaster({
  logger: new CustomLogger(),
  // or use built-in logger with level
  // logger: new DefaultLogger('debug')
});

// Options also support:
// - timeout
// - maxRetries + retryDelay (master)
// Child options additionally support:
// - retryDelay (for child-initiated requests)
// - maxConcurrency (concurrent mode cap)

### Protocol Notes

- Request envelope: `{ type: 'REQUEST', id, action, data, timeout }`
- Response envelope: `{ type: 'RESPONSE', id, status, data?, error? }`
- Optional structured error: `errorPayload?: { name, message, code?, stack? }`
- Master currently sends `{ type: 'REQUEST', request, timeout }` for broader compatibility.
- Child accepts both legacy nested shape and the unified envelope.
 - Master maps structured errors to legacy `error` string for backward compatibility.
```

### Graceful Shutdown

```javascript
const master = new PeepsyMaster();

// Handle shutdown signals
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await master.gracefulShutdown();
  process.exit(0);
});

// Or shutdown specific workers
await master.shutdownChild('worker1', 10000); // 10 second timeout

// Concurrency caps
// Master enforces group `maxConcurrency` using a strict per-group queue
// (no busy-wait). Requests over capacity are queued and dispatched as capacity frees.

// Worker shutdown behavior
// Children perform graceful teardown without forcing process.exit(0),
// disconnecting IPC and allowing natural exit to avoid test runner warnings.
```

## 📚 API Reference

### PeepsyMaster

#### Constructor
```typescript
new PeepsyMaster(options?: PeepsyOptions)
```

#### Methods

| Method | Description |
|--------|-------------|
| `spawnChild(target, scriptPath, mode, groupId?, options?)` | Spawn a new child process |
| `sendRequest(action, targetOrGroup, data?, options?)` | Send request to child process |
| `registerHandler(action, handler)` | Register handler for child requests |
| `shutdownChild(target, timeout?)` | Shutdown specific child process |
| `gracefulShutdown(timeout?)` | Shutdown all child processes |
| `getProcessStats(target)` | Get statistics for specific process |
| `getGroupStats(groupId)` | Get statistics for process group |
| `isProcessAlive(target)` | Check if process is running |

### PeepsyChild

#### Constructor
```typescript
new PeepsyChild(mode?: ProcessMode, options?: PeepsyOptions)
```

#### Methods

| Method | Description |
|--------|-------------|
| `registerHandler(action, handler)` | Register request handler |
| `sendRequest(action, data?, options?)` | Send request to master |
| `getRequestsHandled()` | Get number of requests processed |
| `getQueueSize()` | Get current queue size (sequential mode) |
| `isActive()` | Check if child is active |

### Error Types

- `PeepsyError` - Base error class
- `PeepsyTimeoutError` - Request timeout
- `PeepsyProcessError` - Process-related error  
- `PeepsyNotFoundError` - Target not found

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run linting
npm run lint

# Format code
npm run format
```

## 📈 Performance

Peepsy is designed for high-performance scenarios:

- ✅ **Low Latency**: Minimal overhead for IPC communication
- ✅ **High Throughput**: Efficient request queuing and processing
- ✅ **Memory Efficient**: Automatic cleanup of expired requests
- ✅ **Scalable**: Support for hundreds of concurrent workers

### Benchmarks

| Scenario | Requests/sec | Latency (avg) |
|----------|--------------|---------------|
| Single worker (sequential) | ~5,000 | 0.2ms |
| Single worker (concurrent) | ~15,000 | 0.1ms |
| 4 workers (load balanced) | ~50,000 | 0.3ms |

## 🛠️ Development

```bash
# Clone repository
git clone https://github.com/Outburn-IL/peepsy.git
cd peepsy

# Install dependencies
npm install

# Build project
npm run build

# Run tests
npm test

# Start development mode
npm run dev
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Originally developed as part of the FUME engine by Outburn Ltd.
- Inspired by the need for simple, reliable inter-process communication
- Built with ❤️ for the Node.js community

## 📞 Support

- 📖 [Documentation](https://github.com/Outburn-IL/peepsy/wiki)
- 🐛 [Issue Tracker](https://github.com/Outburn-IL/peepsy/issues)
- 💬 [Discussions](https://github.com/Outburn-IL/peepsy/discussions)

---

**Made with ❤️ by the Peepsy team**