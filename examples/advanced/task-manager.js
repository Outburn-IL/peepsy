/**
 * Advanced example with load balancing, monitoring, and real-time stats
 */

import { PeepsyMaster, DefaultLogger } from '../../dist/index.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

class TaskManager {
  constructor() {
    this.master = new PeepsyMaster({ 
      timeout: 15000,
      maxRetries: 2,
      retryDelay: 500,
      logger: new DefaultLogger('info')
    });
    
    this.isRunning = false;
    this.stats = {
      tasksCompleted: 0,
      tasksErrored: 0,
      startTime: Date.now()
    };
  }

  async initialize() {
    console.log('🚀 Initializing Advanced Task Manager...');
    
    const workerPath = join(__dirname, 'advanced-worker.js');
    
    // CPU-intensive workers (sequential for CPU-bound tasks)
    this.master.spawnChild('cpu1', workerPath, 'sequential', 'cpu-group');
    this.master.spawnChild('cpu2', workerPath, 'sequential', 'cpu-group');
    this.master.spawnChild('cpu3', workerPath, 'sequential', 'cpu-group');
    
    // I/O workers (concurrent for I/O-bound tasks)
    this.master.spawnChild('io1', workerPath, 'concurrent', 'io-group');
    this.master.spawnChild('io2', workerPath, 'concurrent', 'io-group');
    
    // Analytics worker (single instance for data consistency)
    this.master.spawnChild('analytics', workerPath, 'sequential');
    
    // Register master-side handlers
    this.master.registerHandler('reportProgress', async (data) => {
      console.log(`📊 Progress report from ${data.workerName}: ${data.progress}%`);
      return { acknowledged: true, timestamp: Date.now() };
    });
    
    this.master.registerHandler('requestTask', async (data) => {
      // Workers can request new tasks
      const task = this.generateTask();
      console.log(`📋 Assigning task ${task.id} to ${data.workerName}`);
      return task;
    });
    
    console.log('✅ Task Manager initialized');
    this.isRunning = true;
    
    // Start monitoring
    this.startMonitoring();
  }

  generateTask() {
    const taskTypes = ['cpu-intensive', 'io-bound', 'mixed'];
    const taskType = taskTypes[Math.floor(Math.random() * taskTypes.length)];
    
    return {
      id: Math.random().toString(36).substr(2, 9),
      type: taskType,
      data: {
        iterations: Math.floor(Math.random() * 1000) + 100,
        complexity: Math.random(),
        timestamp: Date.now()
      }
    };
  }

  async runCpuIntensiveWorkload() {
    console.log('\\n🔥 Running CPU-intensive workload...');
    
    const tasks = Array.from({ length: 10 }, () => ({
      ...this.generateTask(),
      type: 'cpu-intensive'
    }));

    try {
      const results = await Promise.allSettled(
        tasks.map(task => 
          this.master.sendRequest('processCpuTask', 'cpu-group', task)
        )
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      console.log(`✅ CPU workload completed: ${successful} successful, ${failed} failed`);
      this.stats.tasksCompleted += successful;
      this.stats.tasksErrored += failed;
      
    } catch (error) {
      console.error('❌ CPU workload error:', error);
    }
  }

  async runIoWorkload() {
    console.log('\\n💾 Running I/O workload...');
    
    const tasks = Array.from({ length: 15 }, () => ({
      ...this.generateTask(),
      type: 'io-bound'
    }));

    try {
      const results = await Promise.allSettled(
        tasks.map(task => 
          this.master.sendRequest('processIoTask', 'io-group', task)
        )
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      console.log(`✅ I/O workload completed: ${successful} successful, ${failed} failed`);
      this.stats.tasksCompleted += successful;
      this.stats.tasksErrored += failed;
      
    } catch (error) {
      console.error('❌ I/O workload error:', error);
    }
  }

  async runAnalytics() {
    console.log('\\n📈 Running analytics...');
    
    try {
      const analyticsData = {
        totalTasks: this.stats.tasksCompleted + this.stats.tasksErrored,
        completedTasks: this.stats.tasksCompleted,
        erroredTasks: this.stats.tasksErrored,
        uptime: Date.now() - this.stats.startTime,
        processes: this.master.getAllProcessStats()
      };

      const result = await this.master.sendRequest('generateReport', 'analytics', analyticsData);
      
      console.log('📊 Analytics result:', result.data);
      
    } catch (error) {
      console.error('❌ Analytics error:', error);
    }
  }

  startMonitoring() {
    setInterval(() => {
      if (!this.isRunning) return;
      
      console.log('\\n📊 === REAL-TIME MONITORING ===');
      
      // Overall stats
      const uptime = Math.round((Date.now() - this.stats.startTime) / 1000);
      console.log(`⏱️  Uptime: ${uptime}s | Tasks: ${this.stats.tasksCompleted} ✅ ${this.stats.tasksErrored} ❌`);
      
      // Process stats
      const allStats = this.master.getAllProcessStats();
      Object.entries(allStats).forEach(([name, stats]) => {
        console.log(`🔧 ${name}: ${stats.requestsHandled} handled, ${stats.requestsActive} active, ${stats.errors} errors`);
      });
      
      // Group stats
      ['cpu-group', 'io-group'].forEach(groupId => {
        const groupStats = this.master.getGroupStats(groupId);
        if (groupStats) {
          console.log(`👥 ${groupId}: ${groupStats.totalRequests} total requests, strategy: ${groupStats.strategy}`);
        }
      });
      
      console.log(`🔄 Active requests: ${this.master.getActiveRequestsCount()}`);
      console.log('===============================\\n');
      
    }, 5000);
  }

  async runWorkloadSimulation() {
    console.log('\\n🎯 Starting workload simulation...');
    
    // Run different workloads concurrently
    const workloads = [
      this.runCpuIntensiveWorkload(),
      this.runIoWorkload(),
      new Promise(resolve => setTimeout(() => {
        this.runAnalytics().then(resolve);
      }, 2000))
    ];

    await Promise.allSettled(workloads);
    
    console.log('\\n🎉 Workload simulation completed!');
  }

  async shutdown() {
    console.log('\\n🛑 Shutting down Task Manager...');
    this.isRunning = false;
    
    await this.master.gracefulShutdown(15000);
    console.log('✅ Task Manager shutdown complete');
  }
}

async function main() {
  const taskManager = new TaskManager();
  
  try {
    await taskManager.initialize();
    
    // Run simulation for 30 seconds
    setTimeout(async () => {
      await taskManager.runWorkloadSimulation();
      
      // Run another simulation after a short break
      setTimeout(async () => {
        await taskManager.runWorkloadSimulation();
        await taskManager.shutdown();
        process.exit(0);
      }, 5000);
    }, 2000);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await taskManager.shutdown();
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

main().catch(console.error);