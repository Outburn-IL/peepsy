# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-12-06

### Added
- Initial release of Peepsy library
- Bidirectional IPC communication between master and child processes
- Support for sequential and concurrent request handling
- Load balancing with round-robin, random, and least-busy strategies
- Priority queue system for sequential processing
- Comprehensive error handling with custom error types
- Built-in retry mechanism with configurable delays
- Process statistics and monitoring capabilities
- Graceful shutdown handling
- TypeScript support with full type definitions
- Comprehensive test suite with 75%+ coverage
- ESLint and Prettier configuration
- GitHub Actions CI/CD pipeline
 - Heartbeat signaling from children and master health monitoring
 - Auto-restart of unhealthy children (configurable, can be disabled per group/target)
 - Strict master-side group queuing enforcing `maxConcurrency` with multi-dispatch to capacity
 - Optional structured error payloads (`errorPayload`) in responses alongside legacy `error` string
 - Health helpers (`getUnhealthyProcesses`) and events (`heartbeat-missed`, `auto-restart`)
 - Graceful child shutdown without forcing `process.exit(0)` to avoid test runner warnings
 - Unref’ed timers and process handles to ensure clean teardown in test environments

### Features
- **PeepsyMaster**: Manages child processes and request distribution
- **PeepsyChild**: Handles requests in child processes
- **Group Management**: Organize processes into load-balanced groups
- **Request Timeout**: Automatic timeout handling with configurable values
- **Error Recovery**: Built-in retry mechanism for failed requests
- **Statistics**: Real-time monitoring of process performance
- **Logging**: Configurable logging with multiple levels
- **Health + Restart**: Heartbeats, unhealthy detection, optional auto-restart with toggles
- **Events**: Heartbeat miss and auto-restart events for observability

### Technical
- Node.js 18+ support
- Pure TypeScript implementation
- Zero external dependencies
- CommonJS module format
- Comprehensive JSDoc documentation
- Full test coverage including integration tests
- IPC fork handles unref’ed; timers unref’ed; process listeners guarded to prevent leaks