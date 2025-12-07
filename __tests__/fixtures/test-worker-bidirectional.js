/**
 * Test worker - Bidirectional communication child process for testing
 */

import { PeepsyChild } from '../../dist/index.mjs';

const child = new PeepsyChild('sequential');

// Register handlers for bidirectional communication
child.registerHandler('echo', async (data) => {
  return { echoed: data };
});

child.registerHandler('requestFromMaster', async (data) => {
  // Make a request back to the master process
  const response = await child.sendRequest('masterHandler', data.masterTarget, data.payload);
  return { 
    originalRequest: data,
    masterResponse: response 
  };
});

child.registerHandler('chainedRequest', async (data) => {
  const { chain } = data;
  let result = data.initialValue;
  
  for (const operation of chain) {
    result = await child.sendRequest(operation.handler, operation.target, {
      ...operation.params,
      input: result
    });
  }
  
  return { chainResult: result };
});

child.registerHandler('notifyMaster', async (data) => {
  // Send a notification to master without expecting response
  child.sendRequest('notification', data.target, {
    type: 'info',
    message: data.message,
    timestamp: Date.now()
  }).catch(() => {
    // Ignore errors for notifications
  });
  
  return { notificationSent: true };
});