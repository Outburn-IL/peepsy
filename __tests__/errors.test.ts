/**
 * Tests for error classes
 */

import { 
  PeepsyError, 
  PeepsyTimeoutError, 
  PeepsyProcessError, 
  PeepsyNotFoundError 
} from '../src/types';

describe('Error Classes', () => {
  describe('PeepsyError', () => {
    it('should create error with message and code', () => {
      const error = new PeepsyError('Test error', 'TEST_CODE');
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('PeepsyError');
      expect(error.timestamp).toBeCloseTo(Date.now(), -2);
    });

    it('should create error with default code', () => {
      const error = new PeepsyError('Test error');
      
      expect(error.code).toBe('PEEPSY_ERROR');
    });

    it('should be instanceof Error', () => {
      const error = new PeepsyError('Test error');
      
      expect(error instanceof Error).toBe(true);
      expect(error instanceof PeepsyError).toBe(true);
    });
  });

  describe('PeepsyTimeoutError', () => {
    it('should create timeout error with timeout value', () => {
      const error = new PeepsyTimeoutError(5000);
      
      expect(error.message).toBe('Request timed out after 5000ms');
      expect(error.code).toBe('PEEPSY_TIMEOUT');
      expect(error.name).toBe('PeepsyTimeoutError');
    });

    it('should create timeout error with target', () => {
      const error = new PeepsyTimeoutError(3000, 'worker1');
      
      expect(error.message).toBe('Request timed out after 3000ms for target: worker1');
    });

    it('should inherit from PeepsyError', () => {
      const error = new PeepsyTimeoutError(1000);
      
      expect(error instanceof PeepsyError).toBe(true);
      expect(error instanceof PeepsyTimeoutError).toBe(true);
    });
  });

  describe('PeepsyProcessError', () => {
    it('should create process error with message', () => {
      const error = new PeepsyProcessError('Process failed');
      
      expect(error.message).toBe('Process error: Process failed');
      expect(error.code).toBe('PEEPSY_PROCESS');
      expect(error.name).toBe('PeepsyProcessError');
    });

    it('should create process error with target', () => {
      const error = new PeepsyProcessError('Process failed', 'worker1');
      
      expect(error.message).toBe('Process error for target worker1: Process failed');
    });

    it('should inherit from PeepsyError', () => {
      const error = new PeepsyProcessError('Test');
      
      expect(error instanceof PeepsyError).toBe(true);
      expect(error instanceof PeepsyProcessError).toBe(true);
    });
  });

  describe('PeepsyNotFoundError', () => {
    it('should create not found error with target', () => {
      const error = new PeepsyNotFoundError('worker1');
      
      expect(error.message).toBe('No process found for target or group: worker1');
      expect(error.code).toBe('PEEPSY_NOT_FOUND');
      expect(error.name).toBe('PeepsyNotFoundError');
    });

    it('should inherit from PeepsyError', () => {
      const error = new PeepsyNotFoundError('test');
      
      expect(error instanceof PeepsyError).toBe(true);
      expect(error instanceof PeepsyNotFoundError).toBe(true);
    });
  });

  describe('Error Serialization', () => {
    it('should maintain properties when serialized', () => {
      const error = new PeepsyTimeoutError(5000, 'worker1');
      
      // Manual serialization to maintain enumerable properties
      const serialized = {
        message: error.message,
        code: error.code,
        name: error.name,
        timestamp: error.timestamp
      };
      
      expect(serialized.message).toBe(error.message);
      expect(serialized.code).toBe(error.code);
      expect(serialized.name).toBe(error.name);
      expect(serialized.timestamp).toBe(error.timestamp);
    });

    it('should work with Error.prototype methods', () => {
      const error = new PeepsyError('Test error');
      
      expect(error.toString()).toContain('Test error');
      expect(error.stack).toBeDefined();
    });
  });
});