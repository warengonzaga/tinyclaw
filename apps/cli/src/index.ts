#!/usr/bin/env node

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { homedir } from 'os';
import {
  createDatabase,
  agentLoop,
  createOllamaProvider,
  ProviderOrchestrator,
  logger,
  HeartwareManager,
  createHeartwareTools,
  loadHeartwareContext,
  createLearningEngine,
  type HeartwareConfig
} from '@tinyclaw/core';
import { createWebUI } from '@tinyclaw/ui';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (go up 3 levels: dist -> tinyclaw -> apps -> root)
config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  logger.log('🐜 TinyClaw - Small agent, mighty friend');
  
  // Get data directory
  const dataDir = process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
  
  // Check for API key
  const apiKey = process.env.OLLAMA_API_KEY;
  
  if (!apiKey) {
    logger.error('❌ No API key found!');
    logger.error('\nPlease set OLLAMA_API_KEY environment variable:');
    logger.error('\nTo get an Ollama API key:');
    logger.error('  1. Sign up at https://ollama.com/signup');
    logger.error('  2. Go to https://ollama.com/settings/keys');
    logger.error('  3. Create a new API key\n');
    process.exit(1);
  }
  
  logger.info('\ud83d\udcc2 Data directory:', { dataDir });
  
  // Initialize database
  const dbPath = join(dataDir, 'data', 'tinyclaw.db');
  const db = createDatabase(dbPath);
  logger.info('✅ Database initialized');
  
  // Initialize learning engine
  const learningPath = join(dataDir, 'learning');
  const learning = createLearningEngine({ storagePath: learningPath });
  logger.info('✅ Learning engine initialized');

  // Initialize heartware
  const heartwareConfig: HeartwareConfig = {
    baseDir: join(dataDir, 'heartware'),
    userId: 'default-user', // TODO: Multi-user support
    auditDir: join(dataDir, 'audit'),
    backupDir: join(dataDir, 'heartware', '.backups'),
    maxFileSize: 1_048_576 // 1MB
  };

  const heartwareManager = new HeartwareManager(heartwareConfig);
  await heartwareManager.initialize();
  logger.info('✅ Heartware initialized');

  // Load heartware context
  const heartwareContext = await loadHeartwareContext(heartwareManager);
  logger.info('✅ Heartware context loaded');

  // Initialize provider orchestrator
  const defaultProvider = createOllamaProvider({ apiKey: process.env.OLLAMA_API_KEY! });
  const orchestrator = new ProviderOrchestrator({ defaultProvider });
  
  // Select and verify active provider
  const provider = await orchestrator.selectActiveProvider();
  logger.info('✅ Provider initialized and verified');
  
  // Initialize tools with heartware
  const tools = [
    ...createHeartwareTools(heartwareManager)
  ];
  logger.info('✅ Loaded tools', { count: tools.length });
  
  // Create context
  const context = {
    db,
    provider,
    learning,
    tools,
    heartwareContext
  };
  
  // Initialize Web UI
  const port = parseInt(process.env.PORT || '3000');
  const webUI = createWebUI({
    port,
    onMessage: async (message: string, userId: string) => {
      return await agentLoop(message, userId, context);
    },
    onMessageStream: async (message: string, userId: string, callback) => {
      await agentLoop(message, userId, context, callback);
    }
  });
  
  // Start Web UI
  await webUI.start();
  
  const stats = learning.getStats();
  logger.log(`🧠 Learning: ${stats.totalPatterns} patterns learned`);
  logger.log('');
  logger.log('🎉 TinyClaw is ready!');
  logger.log(`   API server: http://localhost:${port}`);
  logger.log('   Web UI: Run "bun run dev:ui" then open http://localhost:5173');
  logger.log('');
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('👋 Shutting down TinyClaw...');
    db.close();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('\u274c Fatal error:', error);
  process.exit(1);
});
