/**
 * Basic worker example
 */

import { PeepsyChild } from '../../dist/index.js';

const worker = new PeepsyChild(process.argv[2] || 'sequential');
const workerName = `Worker-${process.pid}`;

console.log(`🔧 ${workerName} starting in ${worker.getMode()} mode`);

// Register handlers
worker.registerHandler('echo', async (data) => {
  console.log(`${workerName}: Echo received:`, data);
  return {
    echoed: data,
    processedBy: workerName,
    processedAt: new Date().toISOString()
  };
});

worker.registerHandler('calculate', async (data) => {
  const { operation, number } = data;
  console.log(`${workerName}: Calculating ${operation} of ${number}`);
  
  switch (operation) {
    case 'fibonacci':
      return {
        operation,
        input: number,
        result: fibonacci(number),
        processedBy: workerName
      };
      
    case 'factorial':
      return {
        operation,
        input: number,
        result: factorial(number),
        processedBy: workerName
      };
      
    case 'prime':
      return {
        operation,
        input: number,
        result: isPrime(number),
        processedBy: workerName
      };
      
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
});

worker.registerHandler('workload', async (data) => {
  const { taskId, data: taskData } = data;
  
  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));
  
  return {
    taskId,
    result: `Processed: ${taskData}`,
    processedBy: workerName,
    processingTime: Math.random() * 100 + 50
  };
});

worker.registerHandler('error', async () => {
  throw new Error(`Intentional error from ${workerName}`);
});

worker.registerHandler('slowTask', async (data) => {
  const { delay = 1000 } = data;
  console.log(`${workerName}: Starting slow task (${delay}ms)`);
  
  await new Promise(resolve => setTimeout(resolve, delay));
  
  return {
    completed: true,
    delay,
    processedBy: workerName
  };
});

// Periodically request master status
setInterval(async () => {
  try {
    const masterStatus = await worker.sendRequest('getMasterStatus', {
      workerName,
      requestTime: new Date().toISOString()
    });
    
    console.log(`${workerName}: Master status - PID: ${masterStatus.masterPid}, Uptime: ${Math.round(masterStatus.uptime)}s`);
  } catch (error) {
    console.log(`${workerName}: Failed to get master status:`, error.message);
  }
}, 5000);

// Utility functions
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

function isPrime(n) {
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  
  return true;
}

console.log(`✅ ${workerName} initialized with ${worker.getHandlerCount()} handlers`);