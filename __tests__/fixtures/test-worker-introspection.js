/**
 * Test worker - Introspection worker for testing child introspection capabilities
 */

import { PeepsyChild } from '../../dist/index.mjs';

const child = new PeepsyChild('sequential');

// Register test handlers
child.registerHandler('echo', async (data) => {
  return { echoed: data };
});

child.registerHandler('delay', async (data) => {
  const { ms } = data;
  await new Promise(resolve => setTimeout(resolve, ms));
  return { delayed: ms };
});

child.registerHandler('introspect', async (data) => {
  // Return introspection data about the child process
  return {
    requestsHandled: child.getRequestsHandled(),
    requestsInProgress: child.getRequestsInProgress(),
    queueSize: child.getQueueSize(),
    mode: child.getMode(),
    isActive: child.isActive(),
    handlerCount: child.getHandlerCount(),
    handlerActions: child.getHandlerActions()
  };
});