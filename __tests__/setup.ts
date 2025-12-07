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

// Cleanup after each test
afterEach(async () => {
  // Clear any remaining timers
  jest.clearAllTimers();

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  // Small delay for cleanup
  await new Promise(resolve => setTimeout(resolve, 50));
});

// Cleanup after all tests
afterAll(async () => {
  // Clean up any remaining timers
  jest.clearAllTimers();

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  // Allow time for handles to close
  await new Promise(resolve => setTimeout(resolve, 100));
});
