/**
 * Tests for PeepsyChild class
 */

import { PeepsyChild, PeepsyError } from '../src/index';

// Mock process object for testing
const mockProcess = {
  send: jest.fn(),
  on: jest.fn(),
  removeAllListeners: jest.fn(),
  exit: jest.fn(),
};

// Store original process object
const originalProcess = global.process;

describe('PeepsyChild', () => {
  let child: PeepsyChild;

  beforeEach(() => {
    // Mock process methods
    global.process = { 
      ...originalProcess, 
      send: mockProcess.send,
      on: mockProcess.on,
      removeAllListeners: mockProcess.removeAllListeners,
      exit: mockProcess.exit
    } as any;
    mockProcess.send.mockClear();
    mockProcess.on.mockClear();
    mockProcess.removeAllListeners.mockClear();
    mockProcess.exit.mockClear();
    
    child = new PeepsyChild('sequential');
  });

  afterEach(() => {
    // Restore original process
    global.process = originalProcess;
  });

  describe('Constructor', () => {
    it('should create a child in sequential mode', () => {
      const sequentialChild = new PeepsyChild('sequential');
      expect(sequentialChild.getMode()).toBe('sequential');
      expect(sequentialChild.getQueueSize()).toBe(0);
    });

    it('should create a child in concurrent mode', () => {
      const concurrentChild = new PeepsyChild('concurrent');
      expect(concurrentChild.getMode()).toBe('concurrent');
      expect(concurrentChild.getQueueSize()).toBe(0); // No queue in concurrent mode
    });

    it('should throw error with invalid timeout', () => {
      expect(() => new PeepsyChild('sequential', { timeout: -1 })).toThrow(PeepsyError);
      expect(() => new PeepsyChild('sequential', { timeout: 400000 })).toThrow(PeepsyError);
    });

    it('should throw error without IPC channel', () => {
      global.process = { ...originalProcess, send: undefined } as any;
      expect(() => new PeepsyChild('sequential')).toThrow(PeepsyError);
    });
  });

  describe('Handler Registration', () => {
    it('should register handlers', () => {
      const handler = jest.fn();
      child.registerHandler('test', handler);
      
      expect(child.getHandlerActions()).toContain('test');
      expect(child.getHandlerCount()).toBe(1);
    });

    it('should unregister handlers', () => {
      const handler = jest.fn();
      child.registerHandler('test', handler);
      
      expect(child.unregisterHandler('test')).toBe(true);
      expect(child.unregisterHandler('test')).toBe(false);
      expect(child.getHandlerCount()).toBe(0);
    });

    it('should track multiple handlers', () => {
      child.registerHandler('action1', () => 'result1');
      child.registerHandler('action2', () => 'result2');
      
      expect(child.getHandlerCount()).toBe(2);
      expect(child.getHandlerActions()).toEqual(['action1', 'action2']);
    });
  });

  describe('Request Processing', () => {
    beforeEach(() => {
      child.registerHandler('echo', (data) => ({ echoed: data }));
      child.registerHandler('add', (data: any) => ({ result: data.a + data.b }));
      child.registerHandler('asyncTask', async (data: any) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { completed: data.task };
      });
      child.registerHandler('errorTask', () => {
        throw new Error('Handler error');
      });
    });

    it('should process sync handlers', async () => {
      const request = { id: '1', action: 'echo', data: { message: 'hello' } };
      
      // Simulate message processing
      await (child as any).processRequest(request);
      
      expect(mockProcess.send).toHaveBeenCalledWith({
        type: 'RESPONSE',
        id: '1',
        status: 200,
        data: { echoed: { message: 'hello' } }
      });
    });

    it('should process async handlers', async () => {
      const request = { id: '2', action: 'asyncTask', data: { task: 'test-task' } };
      
      await (child as any).processRequest(request);
      
      expect(mockProcess.send).toHaveBeenCalledWith({
        type: 'RESPONSE',
        id: '2',
        status: 200,
        data: { completed: 'test-task' }
      });
    });

    it('should handle errors in handlers', async () => {
      const request = { id: '3', action: 'errorTask', data: {} };
      
      await (child as any).processRequest(request);
      
      expect(mockProcess.send).toHaveBeenCalledWith({
        type: 'RESPONSE',
        id: '3',
        status: 500,
        error: 'Handler error'
      });
    });

    it('should handle unknown actions', async () => {
      const request = { id: '4', action: 'unknown', data: {} };
      
      await (child as any).processRequest(request);
      
      expect(mockProcess.send).toHaveBeenCalledWith({
        type: 'RESPONSE',
        id: '4',
        status: 404,
        error: 'No handler registered for action: unknown'
      });
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track requests handled', () => {
      expect(child.getRequestsHandled()).toBe(0);
      expect(child.getRequestsInProgress()).toBe(0);
    });

    it('should report active status', () => {
      expect(child.isActive()).toBe(true);
    });

    it('should track queue size for sequential mode', () => {
      const sequentialChild = new PeepsyChild('sequential');
      expect(sequentialChild.getQueueSize()).toBe(0);
    });

    it('should return 0 queue size for concurrent mode', () => {
      const concurrentChild = new PeepsyChild('concurrent');
      expect(concurrentChild.getQueueSize()).toBe(0);
    });
  });

  describe('Send Request', () => {
    it('should send request to master', async () => {
      // Mock successful response
      const responsePromise = child.sendRequest('test-action', { data: 'test' });
      
      // Simulate master response
      const mockResponse = { 
        type: 'RESPONSE', 
        id: expect.any(String), 
        status: 200, 
        data: { result: 'success' } 
      };
      
      // Get the request ID from the sent message
      const sentMessage = mockProcess.send.mock.calls[0][0];
      const responseMessage = { ...mockResponse, id: sentMessage.id };
      
      // Simulate receiving response
      setTimeout(() => {
        (child as any).activeRequests.get(sentMessage.id)?.(responseMessage);
      }, 10);
      
      const result = await responsePromise;
      expect(result).toEqual({ result: 'success' });
    });

    it('should handle request errors', async () => {
      const responsePromise = child.sendRequest('test-action', { data: 'test' });
      
      const sentMessage = mockProcess.send.mock.calls[0][0];
      const errorResponse = { 
        type: 'RESPONSE', 
        id: sentMessage.id,
        status: 500,
        error: 'Test error' 
      };
      
      setTimeout(() => {
        (child as any).activeRequests.get(sentMessage.id)?.(errorResponse);
      }, 10);
      
      await expect(responsePromise).rejects.toThrow('Test error');
    });

    it('should timeout requests', async () => {
      const responsePromise = child.sendRequest('test-action', { data: 'test' }, { timeout: 100 });
      
      await expect(responsePromise).rejects.toThrow('Request timed out');
    });
  });

  describe('Queue Management (Sequential Mode)', () => {
    let sequentialChild: PeepsyChild;

    beforeEach(() => {
      sequentialChild = new PeepsyChild('sequential');
    });

    it('should process requests sequentially', async () => {
      const processedOrder: number[] = [];
      const handler = jest.fn().mockImplementation(async (data: any) => {
        processedOrder.push(data.order);
        // Add small delay to ensure sequential processing is testable
        await new Promise(resolve => setTimeout(resolve, 10));
        return { result: 'processed', order: data.order };
      });
      sequentialChild.registerHandler('test', handler);

      // Enqueue multiple requests quickly
      const request1 = { id: '1', action: 'test', data: { order: 1 } };
      const request2 = { id: '2', action: 'test', data: { order: 2 } };
      
      (sequentialChild as any).enqueueRequest(request1, 5000);
      (sequentialChild as any).enqueueRequest(request2, 5000);
      
      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(handler).toHaveBeenCalledTimes(2);
      expect(sequentialChild.getQueueSize()).toBe(0);
      // Verify sequential processing order
      expect(processedOrder).toEqual([1, 2]);
    });
  });

  describe('Error Handling', () => {
    it('should handle process errors gracefully', () => {
      const errorHandler = jest.fn();
      child.registerHandler('test', errorHandler);
      
      // Should not throw when processing invalid messages
      expect(() => {
        (child as any).setupMessageHandlers();
      }).not.toThrow();
    });

    it('should handle shutdown during active requests', () => {
      child.registerHandler('longTask', () => new Promise(resolve => setTimeout(resolve, 1000)));
      
      expect(() => {
        (child as any).gracefulShutdown();
      }).not.toThrow();
    });
  });
});