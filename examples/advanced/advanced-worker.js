/**
 * Advanced worker with different task types and progress reporting
 */

import { PeepsyChild } from '../../dist/index.js';
import { performance } from 'perf_hooks';

const worker = new PeepsyChild(process.argv[2] || 'sequential');
const workerName = `Worker-${process.pid}`;

console.log(`🔧 ${workerName} starting in ${worker.getMode()} mode`);

// Worker state
let tasksProcessed = 0;
let currentTask = null;

// Register task handlers
worker.registerHandler('processCpuTask', async task => {
  currentTask = task;
  console.log(`${workerName}: Processing CPU task ${task.id}`);

  const startTime = performance.now();

  try {
    // Report progress periodically
    const progressInterval = setInterval(async () => {
      if (currentTask === task) {
        await reportProgress(Math.random() * 100);
      }
    }, 1000);

    // Simulate CPU-intensive work
    const result = await simulateCpuWork(task.data);

    clearInterval(progressInterval);

    const duration = performance.now() - startTime;
    tasksProcessed++;

    await reportProgress(100);

    console.log(`${workerName}: Completed CPU task ${task.id} in ${Math.round(duration)}ms`);

    return {
      taskId: task.id,
      type: 'cpu-intensive',
      result,
      duration,
      processedBy: workerName,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`${workerName}: Error processing CPU task ${task.id}:`, error.message);
    throw error;
  } finally {
    currentTask = null;
  }
});

worker.registerHandler('processIoTask', async task => {
  currentTask = task;
  console.log(`${workerName}: Processing I/O task ${task.id}`);

  const startTime = performance.now();

  try {
    // Simulate I/O work with progress reporting
    const result = await simulateIoWork(task.data);

    const duration = performance.now() - startTime;
    tasksProcessed++;

    console.log(`${workerName}: Completed I/O task ${task.id} in ${Math.round(duration)}ms`);

    return {
      taskId: task.id,
      type: 'io-bound',
      result,
      duration,
      processedBy: workerName,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`${workerName}: Error processing I/O task ${task.id}:`, error.message);
    throw error;
  } finally {
    currentTask = null;
  }
});

worker.registerHandler('generateReport', async data => {
  console.log(`${workerName}: Generating analytics report`);

  const report = {
    reportId: Math.random().toString(36).substring(2, 11),
    generatedAt: new Date().toISOString(),
    generatedBy: workerName,
    summary: {
      totalTasks: data.totalTasks,
      successRate:
        data.totalTasks > 0
          ? ((data.completedTasks / data.totalTasks) * 100).toFixed(2) + '%'
          : '0%',
      uptime: formatDuration(data.uptime),
      averageTasksPerSecond:
        data.uptime > 0 ? (data.totalTasks / (data.uptime / 1000)).toFixed(2) : '0',
    },
    processDetails: Object.entries(data.processes).map(([name, stats]) => ({
      name,
      requestsHandled: stats.requestsHandled,
      errors: stats.errors,
      averageResponseTime: Math.round(stats.averageResponseTime) + 'ms',
      lastActivity: new Date(stats.lastActivity).toISOString(),
    })),
    recommendations: generateRecommendations(data),
  };

  // Simulate report generation time
  await new Promise(resolve => setTimeout(resolve, 500));

  return {
    report,
    generationTime: 500,
    processedBy: workerName,
  };
});

// Utility functions
async function simulateCpuWork(data) {
  const { iterations, complexity } = data;

  // Simulate CPU-intensive computation
  let result = 0;
  const targetIterations = Math.floor(iterations * (complexity + 0.5));

  for (let i = 0; i < targetIterations; i++) {
    // Simulate complex mathematical operations
    result += Math.sqrt(i) * Math.sin(i) * Math.cos(i);

    // Yield occasionally to prevent blocking
    if (i % 10000 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  return {
    iterations: targetIterations,
    result: result.toFixed(6),
    complexity,
  };
}

async function simulateIoWork(data) {
  const { iterations, complexity } = data;

  // Simulate multiple I/O operations
  const operations = Math.floor(iterations / 100);
  const results = [];

  for (let i = 0; i < operations; i++) {
    // Simulate async I/O delay
    const delay = Math.floor(complexity * 100) + 50;
    await new Promise(resolve => setTimeout(resolve, delay));

    results.push({
      operation: i + 1,
      delay,
      timestamp: Date.now(),
    });

    // Report progress
    if (i % 5 === 0) {
      const progress = (i / operations) * 100;
      await reportProgress(progress);
    }
  }

  return {
    operationsCompleted: operations,
    totalDelay: results.reduce((sum, r) => sum + r.delay, 0),
    results: results.slice(0, 5), // Return first 5 for brevity
  };
}

async function reportProgress(progress) {
  try {
    await worker.sendRequest('reportProgress', {
      workerName,
      progress: Math.round(progress),
      timestamp: Date.now(),
      taskId: currentTask?.id,
    });
  } catch (error) {
    // Ignore progress reporting errors
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function generateRecommendations(data) {
  const recommendations = [];

  if (data.erroredTasks > data.completedTasks * 0.1) {
    recommendations.push('High error rate detected. Consider investigating task failures.');
  }

  if (data.totalTasks > 0 && data.completedTasks / data.totalTasks < 0.9) {
    recommendations.push('Task completion rate is below 90%. Review error handling.');
  }

  const avgTasksPerSecond = data.uptime > 0 ? data.totalTasks / (data.uptime / 1000) : 0;
  if (avgTasksPerSecond < 1) {
    recommendations.push(
      'Low throughput detected. Consider optimizing task processing or scaling workers.'
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('System performance looks good! 🚀');
  }

  return recommendations;
}

// Periodically request new tasks (for demonstration)
setInterval(async () => {
  if (!currentTask && Math.random() > 0.7) {
    // 30% chance to request task
    try {
      const task = await worker.sendRequest('requestTask', {
        workerName,
        currentLoad: worker.getRequestsInProgress(),
        tasksProcessed,
      });

      if (task) {
        console.log(`${workerName}: Received self-requested task ${task.id}`);
        // Process the task based on its type
        // Note: In a real scenario, you'd route this through the master
      }
    } catch (error) {
      // Ignore task request errors
    }
  }
}, 3000);

// Log worker startup info
setTimeout(() => {
  console.log(`✅ ${workerName} fully initialized:`);
  console.log(`   Mode: ${worker.getMode()}`);
  console.log(`   Handlers: ${worker.getHandlerCount()}`);
  console.log(`   Actions: [${worker.getHandlerActions().join(', ')}]`);
}, 1000);
