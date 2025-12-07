module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageThreshold: {
    global: {
      branches: 82,
      functions: 93,
      lines: 93,
      statements: 91,
    },
  },
  testTimeout: 30000,
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Force exit after tests to prevent hanging
  forceExit: true,
  // Detect open handles in CI environments
  detectOpenHandles: process.env['CI'] === 'true',
  // More aggressive cleanup for CI
  maxWorkers: 1,
  // Cleanup after each test
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
};
