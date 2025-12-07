/**
 * Test worker - Concurrent mode child process for testing  
 */

import { PeepsyChild } from '../../dist/index.mjs';

const child = new PeepsyChild('concurrent');

// Register test handlers  
child.registerHandler('echo', async (data) => {
  return { echoed: data };
});

child.registerHandler('multiply', async (data) => {
  const { a, b } = data;
  return { result: a * b };
});

child.registerHandler('delay', async (data) => {
  const { ms } = data;
  await new Promise(resolve => setTimeout(resolve, ms));
  return { delayed: ms };
});

child.registerHandler('error', async (data) => {
  throw new Error(`Concurrent test error: ${data.message}`);
});

child.registerHandler('compute', async (data) => {
  const { operation, values } = data;
  let result;
  
  switch (operation) {
    case 'factorial':
      result = values[0];
      for (let i = values[0] - 1; i > 0; i--) {
        result *= i;
      }
      break;
    case 'fibonacci':
      const n = values[0];
      if (n <= 1) return { operation, result: n };
      let a = 0, b = 1;
      for (let i = 2; i <= n; i++) {
        [a, b] = [b, a + b];
      }
      result = b;
      break;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
  
  return { operation, result };
});

// Handler for long running tasks
child.registerHandler('longTask', async (data) => {
  const { duration = 100 } = data;
  await new Promise(resolve => setTimeout(resolve, duration));
  return { completed: true, duration };
});

// Handler for master requests
child.registerHandler('requestMaster', async (data) => {
  const response = await child.sendRequest('masterAction', data);
  return { masterResponse: response };
});