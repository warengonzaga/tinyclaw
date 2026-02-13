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
} from '@tinyclaw/core';
import { loadPlugins } from '@tinyclaw/plugins';
import { createPulseScheduler } from '@tinyclaw/pulse';
import { createIntercom } from '@tinyclaw/intercom';
import { createHybridMatcher } from '@tinyclaw/matcher';
import { createSessionQueue } from '@tinyclaw/queue';
import { logger } from '@tinyclaw/logger';
import { ProviderOrchestrator, type ProviderTierConfig } from '@tinyclaw/router';
import { HeartwareManager, createHeartwareTools, loadHeartwareContext, type HeartwareConfig } from '@tinyclaw/heartware';
import { createLearningEngine } from '@tinyclaw/learning';
import { SecretsManager, createSecretsTools, buildProviderKeyName } from '@tinyclaw/secrets';
import { ConfigManager, createConfigTools } from '@tinyclaw/config';
import { createDelegationTools, createBlackboard, createTimeoutEstimator } from '@tinyclaw/delegation';
import { createMemoryEngine } from '@tinyclaw/memory';
import { createSandbox } from '@tinyclaw/sandbox';
import type { ChannelPlugin, Provider, Tool } from '@tinyclaw/types';
import { createWebUI } from '@tinyclaw/ui';
import { theme } from '../ui/theme.js';
import { RESTART_EXIT_CODE } from '../supervisor.js';

/**
 * Run the agent start flow
 */
export async function startCommand(): Promise<void> {
  logger.log('🐜 TinyClaw — Small agent, mighty friend');

  // --- Data directory ---------------------------------------------------

  const dataDir = process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
  logger.info('📂 Data directory:', { dataDir });

  // --- Initialize secrets engine ----------------------------------------

  let secretsManager: SecretsManager;

  try {
    secretsManager = await SecretsManager.create();
  } catch (err: unknown) {
    // Detect IntegrityError from @wgtechlabs/secrets-engine
    // The HMAC stored in meta.json does not match the database contents.
    // This may indicate file corruption, tampering, or a partial write.
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'INTEGRITY_ERROR'
    ) {
      const storePath = join(homedir(), '.secrets-engine');

      console.log();
      console.log(theme.error('  ✖ Secrets store integrity check failed.'));
      console.log();
      console.log('    The secrets store may have been corrupted or tampered with.');
      console.log('    This can happen due to disk errors, power loss, or external changes.');
      console.log();
      console.log('    To resolve, delete the store and re-run setup:');
      console.log();
      console.log(`      1. ${theme.cmd(`rm -rf ${storePath}`)}`);
      console.log(`      2. ${theme.cmd('tinyclaw setup')}`);
      console.log();
      process.exit(1);
    }

    throw err;
  }

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
    await secretsManager.close();
    process.exit(1);
  }

  // --- Initialize config engine -----------------------------------------

  const configManager = await ConfigManager.create();
  logger.info('✅ Config engine initialized', { configPath: configManager.path });

  // Read provider settings from config (fallback to defaults)
  const providerModel =
    configManager.get<string>('providers.starterBrain.model') ?? 'gpt-oss:120b-cloud';
  const providerBaseUrl =
    configManager.get<string>('providers.starterBrain.baseUrl') ?? 'https://ollama.com';

  // --- Initialize database ----------------------------------------------

  const dbPath = join(dataDir, 'data', 'agent.db');
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

  // --- Initialize default provider (reads key from secrets-engine) ------

  const defaultProvider = createOllamaProvider({
    secrets: secretsManager,
    model: providerModel,
    baseUrl: providerBaseUrl,
  });

  // Verify default provider is reachable
  await new ProviderOrchestrator({ defaultProvider }).selectActiveProvider();
  logger.info('✅ Default provider initialized and verified');

  // --- Load plugins ------------------------------------------------------

  const plugins = await loadPlugins(configManager);
  logger.info('✅ Plugins loaded', {
    channels: plugins.channels.length,
    providers: plugins.providers.length,
    tools: plugins.tools.length,
  });

  // --- Initialize plugin providers ---------------------------------------

  const pluginProviders: Provider[] = [];

  for (const pp of plugins.providers) {
    try {
      const provider = await pp.createProvider(secretsManager);
      pluginProviders.push(provider);
      logger.info(`✅ Plugin provider initialized: ${pp.name} (${provider.id})`);
    } catch (err) {
      logger.error(`Failed to initialize provider plugin "${pp.name}":`, err);
    }
  }

  // --- Initialize smart routing orchestrator -----------------------------

  const tierMapping = configManager.get<ProviderTierConfig>('routing.tierMapping');

  const orchestrator = new ProviderOrchestrator({
    defaultProvider,
    providers: pluginProviders,
    tierMapping: tierMapping ?? undefined,
  });

  logger.info('✅ Smart routing initialized', {
    providers: orchestrator.getRegistry().ids(),
    tierMapping: tierMapping ?? 'all-default',
  });

  // --- Initialize tools -------------------------------------------------

  const tools = [
    ...createHeartwareTools(heartwareManager),
    ...createSecretsTools(secretsManager),
    ...createConfigTools(configManager),
  ];

  // Merge plugin pairing tools (channels + providers)
  const pairingTools = [
    ...plugins.channels.flatMap(
      (ch) => ch.getPairingTools?.(secretsManager, configManager) ?? [],
    ),
    ...plugins.providers.flatMap(
      (pp) => pp.getPairingTools?.(secretsManager, configManager) ?? [],
    ),
  ];

  // Create a temporary context for plugin tools that need AgentContext
  const baseContext = {
    db,
    provider: defaultProvider,
    learning,
    tools,
    heartwareContext,
    secrets: secretsManager,
    configManager,
  };

  const pluginTools = plugins.tools.flatMap(
    (tp) => tp.createTools(baseContext),
  );

  const allTools = [...tools, ...pairingTools, ...pluginTools];

  // --- Initialize session queue (before delegation — background runner needs it) --

  const queue = createSessionQueue();
  logger.info('✅ Session queue initialized');

  // --- Initialize v3 subsystems ------------------------------------------

  // Intercom (before delegation — delegation emits events)
  const intercom = createIntercom();
  logger.info('✅ Intercom initialized');

  // Memory engine (after db — uses episodic_memory + memory_fts tables)
  const memoryEngine = createMemoryEngine(db);
  logger.info('✅ Memory engine initialized (episodic + FTS5 + temporal decay)');

  // Hybrid semantic matcher (standalone, no deps)
  const matcher = createHybridMatcher();
  logger.info('✅ Hybrid matcher initialized');

  // Timeout estimator (after db — uses task_metrics table)
  const timeoutEstimator = createTimeoutEstimator(db);
  logger.info('✅ Timeout estimator initialized');

  // Code execution sandbox
  const sandbox = createSandbox();
  logger.info('✅ Sandbox initialized');

  // Blackboard (after db + intercom)
  const blackboard = createBlackboard(db, intercom);
  logger.info('✅ Blackboard initialized');

  // execute_code tool — sandboxed code execution for agents
  const executeCodeTool: Tool = {
    name: 'execute_code',
    description:
      'Execute JavaScript/TypeScript code in a sandboxed environment. ' +
      'No filesystem or network access by default. ' +
      'Use `return` to produce output. Use `input` variable to access passed data.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The JavaScript/TypeScript code to execute' },
        input: { description: 'Optional data to pass as the `input` variable in the sandbox' },
        timeout: { type: 'number', description: 'Override timeout in ms (max 30s)' },
      },
      required: ['code'],
    },
    async execute(args) {
      const code = String(args.code || '');
      if (!code) return 'Error: code is required.';

      const timeout = args.timeout ? Math.min(Number(args.timeout), 30_000) : undefined;
      const input = args.input;

      const result = input !== undefined
        ? await sandbox.executeWithInput(code, input, { timeoutMs: timeout })
        : await sandbox.execute(code, { timeoutMs: timeout });

      if (result.success) {
        return result.output || '(no output)';
      }
      return `Error: ${result.error || 'Unknown execution error'} (${result.durationMs}ms)`;
    },
  };

  // Add execute_code to allTools before delegation
  allTools.push(executeCodeTool);

  // tinyclaw_restart tool — allows the agent to trigger a graceful restart
  const restartTool: Tool = {
    name: 'tinyclaw_restart',
    description:
      'Gracefully restart TinyClaw. Use this after configuration changes that ' +
      'require a restart (e.g., pairing a new provider or channel plugin). ' +
      'The process supervisor will automatically respawn the agent with the ' +
      'updated configuration. Tell the user a restart is happening before calling this.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Human-readable reason for the restart (logged for diagnostics)',
        },
      },
      required: [],
    },
    async execute(args) {
      const reason = (args.reason as string) || 'Agent-initiated restart';
      logger.info(`🔄 Restart requested: ${reason}`);

      // Give a short delay so the response can be sent to the user
      setTimeout(() => {
        process.exit(RESTART_EXIT_CODE);
      }, 500);

      return (
        'Restart initiated. TinyClaw will shut down and automatically respawn ' +
        'with the updated configuration in a few seconds.'
      );
    },
  };

  allTools.push(restartTool);

  // --- Create delegation v2 subsystems -----------------------------------

  const delegationResult = createDelegationTools({
    orchestrator,
    allTools,
    db,
    heartwareContext,
    learning,
    queue,
  });

  const allToolsWithDelegation = [...allTools, ...delegationResult.tools];
  logger.info('✅ Loaded tools', { count: allToolsWithDelegation.length });

  // --- Create agent context ---------------------------------------------

  const context = {
    db,
    provider: defaultProvider,
    learning,
    tools: allToolsWithDelegation,
    heartwareContext,
    secrets: secretsManager,
    configManager,
    delegation: {
      lifecycle: delegationResult.lifecycle,
      templates: delegationResult.templates,
      background: delegationResult.background,
    },
    memory: memoryEngine,
  };

  // --- Initialize pulse scheduler -----------------------------------------

  const pulse = createPulseScheduler();

  pulse.register({
    id: 'memory-consolidation',
    schedule: '24h',
    handler: async () => {
      await queue.enqueue('pulse', async () => {
        await agentLoop(
          'Review your recent memory logs and consolidate any important patterns or facts into long-term memory. Be brief.',
          'pulse',
          context,
        );
      });
    },
  });

  pulse.register({
    id: 'delegation-cleanup',
    schedule: '24h',
    handler: async () => {
      const cleaned = delegationResult.lifecycle.cleanup();
      const stale = delegationResult.background.cleanupStale(5 * 60 * 1000);
      if (cleaned > 0 || stale > 0) {
        logger.info('Delegation cleanup', { expiredAgents: cleaned, staleTasks: stale });
      }
    },
  });

  // v3: Memory consolidation — merge duplicates, prune low-importance, decay old memories
  pulse.register({
    id: 'memory-consolidation-v3',
    schedule: '6h',
    handler: async () => {
      const result = memoryEngine.consolidate('default-user');
      if (result.merged > 0 || result.pruned > 0 || result.decayed > 0) {
        logger.info('Memory consolidation', result);
      }
    },
  });

  // v3: Blackboard cleanup — remove resolved problems older than 7 days
  pulse.register({
    id: 'blackboard-cleanup',
    schedule: '24h',
    handler: async () => {
      const cleaned = blackboard.cleanup(7 * 24 * 60 * 60 * 1000);
      if (cleaned > 0) {
        logger.info('Blackboard cleanup', { removed: cleaned });
      }
    },
  });

  pulse.start();
  logger.info('✅ Pulse scheduler initialized');

  // --- Start Web UI / API server ----------------------------------------

  const port = parseInt(process.env.PORT || '3000', 10);
  const webUI = createWebUI({
    port,
    onMessage: async (message: string, userId: string) => {
      const { provider, classification, failedOver } =
        await orchestrator.routeWithHealth(message);
      logger.debug('Routed query', {
        tier: classification.tier,
        provider: provider.id,
        confidence: classification.confidence.toFixed(2),
        failedOver,
      });
      const routedContext = { ...context, provider };
      return await queue.enqueue(userId, () =>
        agentLoop(message, userId, routedContext),
      );
    },
    onMessageStream: async (message: string, userId: string, callback) => {
      const { provider, classification, failedOver } =
        await orchestrator.routeWithHealth(message);
      logger.debug('Routed query (stream)', {
        tier: classification.tier,
        provider: provider.id,
        failedOver,
      });
      const routedContext = { ...context, provider };
      await queue.enqueue(userId, () =>
        agentLoop(message, userId, routedContext, callback),
      );
    },
  });

  await webUI.start();

  // --- Start channel plugins ---------------------------------------------

  const pluginRuntimeContext = {
    enqueue: async (userId: string, message: string) => {
      const { provider } = await orchestrator.routeWithHealth(message);
      const routedContext = { ...context, provider };
      return queue.enqueue(userId, () =>
        agentLoop(message, userId, routedContext),
      );
    },
    agentContext: context,
    secrets: secretsManager,
    configManager,
  };

  for (const channel of plugins.channels) {
    try {
      await channel.start(pluginRuntimeContext);
      logger.info(`✅ Channel plugin started: ${channel.name}`);
    } catch (err) {
      logger.error(`Failed to start channel plugin "${channel.name}":`, err);
    }
  }

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

    // 0. Pulse scheduler + session queue
    try {
      pulse.stop();
      queue.stop();
      logger.info('Pulse scheduler and session queue stopped');
    } catch (err) {
      logger.error('Error stopping pulse/queue:', err);
    }

    // 0.5. Cancel background delegation tasks
    try {
      delegationResult.background.cancelAll();
      logger.info('Background tasks cancelled');
    } catch (err) {
      logger.error('Error cancelling background tasks:', err);
    }

    // 0.55. Sandbox shutdown — terminate all running workers
    try {
      sandbox.shutdown();
      logger.info('Sandbox workers terminated');
    } catch (err) {
      logger.error('Error shutting down sandbox:', err);
    }

    // 0.56. Intercom cleanup — clear all subscriptions
    try {
      intercom.clear();
      logger.info('Intercom cleared');
    } catch (err) {
      logger.error('Error clearing intercom:', err);
    }

    // 0.6. Channel plugins
    for (const channel of plugins.channels) {
      try {
        await channel.stop();
        logger.info(`Channel plugin stopped: ${channel.name}`);
      } catch (err) {
        logger.error(`Error stopping channel plugin "${channel.name}":`, err);
      }
    }

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
      await secretsManager.close();
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
