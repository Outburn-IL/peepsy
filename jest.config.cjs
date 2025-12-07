module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
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