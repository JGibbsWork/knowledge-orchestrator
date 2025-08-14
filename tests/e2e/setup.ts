import { MockMemoryServer } from '../mocks/memory-server.js';
import { MockNotionServer } from '../mocks/notion-server.js';

/**
 * H2: Global test setup for E2E tests
 * Handles mock server lifecycle management
 */

let memoryServer: MockMemoryServer;
let notionServer: MockNotionServer;

export async function setupMockServers() {
  console.log('Starting mock servers for E2E tests...');
  
  memoryServer = new MockMemoryServer(3001);
  notionServer = new MockNotionServer(3002);
  
  await Promise.all([
    memoryServer.start(),
    notionServer.start()
  ]);
  
  console.log('Mock servers started successfully');
  
  // Wait a moment for servers to be fully ready
  await new Promise(resolve => setTimeout(resolve, 1000));
}

export async function teardownMockServers() {
  console.log('Stopping mock servers...');
  
  if (memoryServer) {
    await memoryServer.stop();
  }
  
  if (notionServer) {
    await notionServer.stop();
  }
  
  console.log('Mock servers stopped');
}

export function getMemoryServer() {
  return memoryServer;
}

export function getNotionServer() {
  return notionServer;
}