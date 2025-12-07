module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageThreshold: {
    global: {
      branches: 83,
      functions: 94,
      lines: 93,
      statements: 92,
    },
  },
  testTimeout: 30000,
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Force exit after tests to prevent hanging
  forceExit: true,
  // Detect open handles in CI
  detectOpenHandles: process.env.CI === 'true',
  // Cleanup after each test
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
};
