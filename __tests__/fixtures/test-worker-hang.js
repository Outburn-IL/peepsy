/**
 * Test worker - Hang worker for testing shutdown behavior with in-progress requests
 */

import { PeepsyChild } from '../../dist/index.mjs';

const child = new PeepsyChild('concurrent');

// Register test handlers
child.registerHandler('ping', async data => {
  return { ok: true, data };
});

child.registerHandler('hang', async () => {
  // This handler intentionally hangs for a reasonable time
  // It's designed to be interrupted by shutdown signals
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 3000); // 3 second hang

    // Clean up on any termination signal
    const cleanup = reason => {
      clearTimeout(timer);
      reject(new Error(`Process interrupted: ${reason}`));
    };

    process.once('disconnect', () => cleanup('disconnect'));
    process.once('SIGTERM', () => cleanup('SIGTERM'));
    process.once('SIGINT', () => cleanup('SIGINT'));
  });
  return { completed: true };
});
