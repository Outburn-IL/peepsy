/**
 * Test worker - Sequential mode child process for testing
 */

import { PeepsyChild } from '../../dist/index.mjs';

const child = new PeepsyChild('sequential');

// Register test handlers
child.registerHandler('echo', async (data) => {
  return { echoed: data };
});

child.registerHandler('add', async (data) => {
  const { a, b } = data;
  return { result: a + b };
});

child.registerHandler('delay', async (data) => {
  const { ms } = data;
  await new Promise(resolve => setTimeout(resolve, ms));
  return { delayed: ms };
});

child.registerHandler('error', async (data) => {
  throw new Error(`Test error: ${data.message}`);
});

child.registerHandler('compute', async (data) => {
  const { operation, values } = data;
  let result;
  
  switch (operation) {
    case 'sum':
      result = values.reduce((acc, val) => acc + val, 0);
      break;
    case 'product':
      result = values.reduce((acc, val) => acc * val, 1);
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