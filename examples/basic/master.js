/**
 * Basic example demonstrating Peepsy usage
 * Run with: node examples/basic/master.js
 */

import { PeepsyMaster } from '../../dist/index.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const master = new PeepsyMaster({ timeout: 10000 });
  
  console.log('🚀 Starting Peepsy basic example...');
  
  try {
    // Spawn worker processes
    const workerPath = join(__dirname, 'worker.js');
    master.spawnChild('worker1', workerPath, 'sequential');
    master.spawnChild('worker2', workerPath, 'concurrent', 'worker-group');
    master.spawnChild('worker3', workerPath, 'concurrent', 'worker-group');
    
    // Register handler for child-initiated requests
    master.registerHandler('getMasterStatus', async (data) => {
      return {
        masterPid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: Date.now(),
        requestFrom: data
      };
    });
    
    console.log('✅ Workers spawned successfully');
    
    // Wait a moment for workers to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Example 1: Simple echo request
    console.log('\\n📤 Example 1: Echo request');
    const echoResponse = await master.sendRequest('echo', 'worker1', { 
      message: 'Hello from master!',
      timestamp: Date.now()
    });
    console.log('📥 Echo response:', echoResponse.data);
    
    // Example 2: Math operations
    console.log('\\n🔢 Example 2: Math operations');
    const mathResponse = await master.sendRequest('calculate', 'worker1', {
      operation: 'fibonacci',
      number: 10
    });
    console.log('📊 Math result:', mathResponse.data);
    
    // Example 3: Load balanced requests
    console.log('\\n⚖️ Example 3: Load balanced requests');
    const loadBalancedPromises = Array.from({ length: 5 }, (_, i) => 
      master.sendRequest('workload', 'worker-group', { 
        taskId: i + 1,
        data: `Task ${i + 1} data`
      })
    );
    
    const loadBalancedResults = await Promise.all(loadBalancedPromises);
    console.log('📋 Load balanced results:');
    loadBalancedResults.forEach((result, i) => {
      console.log(`  Task ${i + 1}:`, result.data);
    });
    
    // Example 4: Error handling
    console.log('\\n❌ Example 4: Error handling');
    try {
      await master.sendRequest('error', 'worker1');
    } catch (error) {
      console.log('🚨 Caught expected error:', error.message);
    }
    
    // Example 5: Timeout handling
    console.log('\\n⏱️ Example 5: Timeout handling');
    try {
      await master.sendRequest('slowTask', 'worker1', { delay: 3000 }, { timeout: 1000 });
    } catch (error) {
      console.log('⏰ Caught timeout error:', error.message);
    }
    
    // Show statistics
    console.log('\\n📊 Process Statistics:');
    const worker1Stats = master.getProcessStats('worker1');
    const groupStats = master.getGroupStats('worker-group');
    
    console.log('Worker 1 stats:', {
      requestsHandled: worker1Stats?.requestsHandled,
      errors: worker1Stats?.errors
    });
    
    console.log('Worker group stats:', {
      totalRequests: groupStats?.totalRequests,
      strategy: groupStats?.strategy,
      processCount: Object.keys(groupStats?.processes || {}).length
    });
    
    // Wait for child-initiated request
    console.log('\\n⏳ Waiting for child-initiated requests...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (error) {
    console.error('❌ Error in main:', error);
  } finally {
    console.log('\\n🛑 Shutting down gracefully...');
    await master.gracefulShutdown();
    console.log('✅ Shutdown complete');
  }
}

main().catch(console.error);