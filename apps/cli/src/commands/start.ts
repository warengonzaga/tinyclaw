/**
 * Start Command
 *
 * Boots the TinyClaw agent: initializes all subsystems, verifies provider
 * connectivity, and starts the Web UI / API server.
 *
 * Pre-flight check: ensures at least one provider API key is configured
 * via secrets-engine before proceeding. If not, directs the user to run
 * `tinyclaw setup`.
 */

import { join } from 'path';
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
  ConfigManager,
  createSecretsTools,
  createConfigTools,
  buildProviderKeyName,
  type HeartwareConfig,
} from '@tinyclaw/core';
import { createWebUI } from '@tinyclaw/ui';
import { theme } from '../ui/theme.js';

/**
 * Run the agent start flow
 */
export async function startCommand(): Promise<void> {
  logger.log('🐜 TinyClaw — Small agent, mighty friend');

  // --- Data directory ---------------------------------------------------

  const dataDir = process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
  logger.info('📂 Data directory:', { dataDir });

  // --- Initialize secrets engine ----------------------------------------

  const secretsManager = await SecretsManager.create();
  logger.info('✅ Secrets engine initialized', {
    storagePath: secretsManager.storagePath,
  });

  // --- Pre-flight: check for provider API key --------------------------

  const hasOllamaKey = await secretsManager.check(
    buildProviderKeyName('ollama')
  );

  if (!hasOllamaKey) {
    console.log();
    console.log(
      theme.error('  ✖ No provider API key found.')
    );
    console.log(
      `    Run ${theme.cmd('tinyclaw setup')} to configure your provider.`
    );
    console.log();
    secretsManager.close();
    process.exit(1);
  }

  // --- Initialize config engine -----------------------------------------

  const configManager = await ConfigManager.create();
  logger.info('✅ Config engine initialized', { configPath: configManager.path });

  // Read provider settings from config (fallback to defaults)
  const providerModel =
    configManager.get<string>('providers.starterBrain.model') ?? 'llama3.2:3b';
  const providerBaseUrl =
    configManager.get<string>('providers.starterBrain.baseUrl') ?? 'https://ollama.com';

  // --- Initialize database ----------------------------------------------

  const dbPath = join(dataDir, 'data', 'tinyclaw.db');
  const db = createDatabase(dbPath);
  logger.info('✅ Database initialized');

  // --- Initialize learning engine ---------------------------------------

  const learningPath = join(dataDir, 'learning');
  const learning = createLearningEngine({ storagePath: learningPath });
  logger.info('✅ Learning engine initialized');

  // --- Initialize heartware ---------------------------------------------

  const heartwareConfig: HeartwareConfig = {
    baseDir: join(dataDir, 'heartware'),
    userId: 'default-user',
    auditDir: join(dataDir, 'audit'),
    backupDir: join(dataDir, 'heartware', '.backups'),
    maxFileSize: 1_048_576, // 1 MB
  };

  const heartwareManager = new HeartwareManager(heartwareConfig);
  await heartwareManager.initialize();
  logger.info('✅ Heartware initialized');

  const heartwareContext = await loadHeartwareContext(heartwareManager);
  logger.info('✅ Heartware context loaded');

  // --- Initialize provider (reads key from secrets-engine) --------------

  const defaultProvider = createOllamaProvider({
    secrets: secretsManager,
    model: providerModel,
    baseUrl: providerBaseUrl,
  });

  const orchestrator = new ProviderOrchestrator({ defaultProvider });
  const provider = await orchestrator.selectActiveProvider();
  logger.info('✅ Provider initialized and verified');

  // --- Initialize tools -------------------------------------------------

  const tools = [
    ...createHeartwareTools(heartwareManager),
    ...createSecretsTools(secretsManager),
    ...createConfigTools(configManager),
  ];
  logger.info('✅ Loaded tools', { count: tools.length });

  // --- Create agent context ---------------------------------------------

  const context = {
    db,
    provider,
    learning,
    tools,
    heartwareContext,
    secrets: secretsManager,
    configManager,
  };

  // --- Start Web UI / API server ----------------------------------------

  const port = parseInt(process.env.PORT || '3000', 10);
  const webUI = createWebUI({
    port,
    onMessage: async (message: string, userId: string) => {
      return await agentLoop(message, userId, context);
    },
    onMessageStream: async (message: string, userId: string, callback) => {
      await agentLoop(message, userId, context, callback);
    },
  });

  await webUI.start();

  const stats = learning.getStats();
  logger.log(`🧠 Learning: ${stats.totalPatterns} patterns learned`);
  logger.log('');
  logger.log('🎉 TinyClaw is ready!');
  logger.log(`   API server: http://localhost:${port}`);
  logger.log('   Web UI: Run "bun run dev:ui" then open http://localhost:5173');
  logger.log('');

  // --- Graceful shutdown ------------------------------------------------

  let isShuttingDown = false;

  process.on('SIGINT', async () => {
    if (isShuttingDown) {
      logger.info('Shutdown already in progress, ignoring signal');
      return;
    }
    isShuttingDown = true;
    logger.info('👋 Shutting down TinyClaw...');

    // 1. Web UI
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

    // 2. Learning engine
    try {
      if (typeof (learning as any).close === 'function') {
        await (learning as any).close();
      }
      logger.info('Learning engine closed');
    } catch (err) {
      logger.error('Error closing learning engine:', err);
    }

    // 3. Heartware
    try {
      if (typeof (heartwareManager as any).close === 'function') {
        await (heartwareManager as any).close();
      }
      logger.info('Heartware manager closed');
    } catch (err) {
      logger.error('Error closing heartware manager:', err);
    }

    // 4. Config engine
    try {
      configManager.close();
      logger.info('Config engine closed');
    } catch (err) {
      logger.error('Error closing config engine:', err);
    }

    // 5. Secrets engine
    try {
      secretsManager.close();
      logger.info('Secrets engine closed');
    } catch (err) {
      logger.error('Error closing secrets engine:', err);
    }

    // 6. Database (last — other services may flush here)
    try {
      db.close();
      logger.info('Database closed');
    } catch (err) {
      logger.error('Error closing database:', err);
    }

    process.exit(0);
  });
}
