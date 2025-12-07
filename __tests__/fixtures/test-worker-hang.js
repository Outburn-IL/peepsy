/**
 * Test worker - Hang worker for testing shutdown behavior with in-progress requests
 */

import { PeepsyChild } from '../../dist/index.mjs';

const child = new PeepsyChild('concurrent');

// Register test handlers
child.registerHandler('ping', async (data) => {
  return { ok: true, data };
});

child.registerHandler('hang', async (data) => {
  // This handler intentionally hangs for a long time
  await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second hang
  return { completed: true };
});