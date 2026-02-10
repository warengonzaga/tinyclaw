#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
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
  SecretsManager,
  createSecretsTools,
  type HeartwareConfig
} from '@tinyclaw/core';
import { createWebUI } from '@tinyclaw/ui';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  logger.log('🐜 TinyClaw - Small agent, mighty friend');
  
  // Get data directory
  const dataDir = process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
  
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

  // Initialize secrets manager (encrypted store at ~/.secrets-engine/)
  const secretsManager = await SecretsManager.create();
  logger.info('✅ Secrets engine initialized', { storagePath: secretsManager.storagePath });

  // Initialize provider orchestrator (API key resolved from secrets-engine)
  const defaultProvider = createOllamaProvider({ secrets: secretsManager });
  const orchestrator = new ProviderOrchestrator({ defaultProvider });
  
  // Select and verify active provider
  const provider = await orchestrator.selectActiveProvider();
  logger.info('✅ Provider initialized and verified');
  
  // Initialize tools with heartware + secrets
  const tools = [
    ...createHeartwareTools(heartwareManager),
    ...createSecretsTools(secretsManager)
  ];
  logger.info('✅ Loaded tools', { count: tools.length });
  
  // Create context
  const context = {
    db,
    provider,
    learning,
    tools,
    heartwareContext,
    secrets: secretsManager
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
  process.on('SIGINT', async () => {
    logger.info('👋 Shutting down TinyClaw...');

    try {
      if (typeof (webUI as any).stop === 'function') {
        await (webUI as any).stop();
      } else if (typeof (webUI as any).close === 'function') {
        await (webUI as any).close();
      }
      logger.info('Web UI stopped');
    } catch (err) {
      logger.error('Error stopping Web UI:', err);
    }

    try {
      secretsManager.close();
      logger.info('Secrets engine closed');
    } catch (err) {
      logger.error('Error closing secrets engine:', err);
    }

    try {
      db.close();
      logger.info('Database closed');
    } catch (err) {
      logger.error('Error closing database:', err);
    }

    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('\u274c Fatal error:', error);
  process.exit(1);
});
