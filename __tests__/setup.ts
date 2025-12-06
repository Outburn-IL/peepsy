/**
 * Jest setup for Peepsy tests
 */

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console methods to reduce noise during testing
const originalConsole = global.console;

beforeEach(() => {
  // Reset console mocks before each test
  global.console = {
    ...originalConsole,
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

afterEach(() => {
  // Restore original console
  global.console = originalConsole;
});

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Cleanup after all tests
afterAll(() => {
  // Clean up any remaining timers
  jest.clearAllTimers();
});