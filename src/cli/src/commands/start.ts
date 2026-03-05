/**
 * Start Command
 *
 * Boots the Tiny Claw agent: initializes all subsystems, verifies provider
 * connectivity, and starts the Web UI / API server.
 *
 * Pre-flight check: ensures at least one provider API key is configured
 * via secrets-engine before proceeding. If not, directs the user to run
 * `tinyclaw setup`.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCompactor } from '@tinyclaw/compactor';
import { ConfigManager, createConfigTools } from '@tinyclaw/config';
import {
  agentLoop,
  BUILTIN_MODEL_TAGS,
  buildUpdateContext,
  checkForUpdate,
  createDatabase,
  createOllamaProvider,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
} from '@tinyclaw/core';
import {
  createBlackboard,
  createDelegationTools,
  createTimeoutEstimator,
} from '@tinyclaw/delegation';
import { createGateway } from '@tinyclaw/gateway';
import {
  createHeartwareTools,
  type HeartwareConfig,
  HeartwareManager,
  loadHeartwareContext,
  loadShieldContent,
  parseSeed,
} from '@tinyclaw/heartware';
import { createIntercom } from '@tinyclaw/intercom';
import { createLearningEngine } from '@tinyclaw/learning';
import { type LogModeName, logger, setLogMode } from '@tinyclaw/logger';
import { createMemoryEngine } from '@tinyclaw/memory';
import {
  createCompanionJobs,
  createNudgeEngine,
  createNudgeTools,
  getCompanionTouchActivity,
  wireNudgeToIntercom,
} from '@tinyclaw/nudge';
import {
  buildPluginUpdateContext,
  checkPluginUpdates,
  discoverPairingTools,
  getCommunityPlugins,
  installCommunityPlugin,
  listCommunityPlugins,
  loadPlugins,
  removeCommunityPlugin,
} from '@tinyclaw/plugins';
import { createPulseScheduler } from '@tinyclaw/pulse';
import { createSessionQueue } from '@tinyclaw/queue';
import { ProviderOrchestrator, type ProviderTierConfig } from '@tinyclaw/router';
import { createSandbox } from '@tinyclaw/sandbox';
import { buildProviderKeyName, createSecretsTools, SecretsManager } from '@tinyclaw/secrets';
import { createShellEngine, createShellTools } from '@tinyclaw/shell';
import { createShieldEngine } from '@tinyclaw/shield';
import type { Provider, StreamCallback, Tool } from '@tinyclaw/types';
import { createWebUI } from '@tinyclaw/web';
import { RESTART_EXIT_CODE } from '../supervisor.js';
import { theme } from '../ui/theme.js';

/**
 * Run the agent start flow
 */
export async function startCommand(): Promise<void> {
  // Apply --verbose flag (overrides stored config level)
  const isVerbose = process.argv.includes('--verbose');
  if (!isVerbose) {
    // Default to info; config override is applied below after config loads
    setLogMode('info');
  } else {
    setLogMode('debug');
  }

  logger.log('Tiny Claw — Small agent, mighty friend', undefined, { emoji: '🐜' });

  // --- Data directory ---------------------------------------------------

  const dataDir = process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
  logger.info('Data directory:', { dataDir }, { emoji: '📂' });

  // --- Load soul seed from config (set during setup wizard) --------------

  let seedOverride: number | undefined;
  try {
    const cfgTmp = await ConfigManager.create();
    const configSeed = cfgTmp.get<number>('heartware.seed');
    if (configSeed !== undefined) {
      seedOverride = parseSeed(configSeed);
      logger.info('Soul seed loaded from config', { seed: seedOverride }, { emoji: '🧬' });
    }
    cfgTmp.close();
  } catch {
    // Config not available yet — will be created during setup
  }

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

  logger.info(
    'Secrets engine initialized',
    {
      storagePath: secretsManager.storagePath,
    },
    { emoji: '✅' },
  );

  // --- Initialize config engine -----------------------------------------

  const configManager = await ConfigManager.create();
  logger.info('Config engine initialized', { configPath: configManager.path }, { emoji: '✅' });

  // Apply log level from config (unless --verbose overrides)
  if (!isVerbose) {
    const configLogLevel = configManager.get<string>('logging.level');
    if (configLogLevel) {
      setLogMode(configLogLevel as LogModeName);
    }
  }

  // --- Pre-flight: validate that setup has been completed ---------------
  // Check for API key, soul seed, and owner authority config. All three
  // must be present for the agent to run. After a purge, the config DB
  // (soul seed + owner auth) is wiped even if secrets are preserved.

  const hasOllamaKey = await secretsManager.check(buildProviderKeyName('ollama'));
  const hasSoulSeed = configManager.get<number>('heartware.seed') !== undefined;
  const hasOwnerAuth = configManager.get<string>('owner.ownerId') !== undefined;

  if (!hasOllamaKey || !hasSoulSeed || !hasOwnerAuth) {
    const missing: string[] = [];
    if (!hasOllamaKey) missing.push('API key');
    if (!hasSoulSeed) missing.push('soul seed');
    if (!hasOwnerAuth) missing.push('owner authentication');

    const reason = `Setup not completed yet — missing: ${missing.join(', ')}.`;

    logger.info('─'.repeat(52), undefined, { emoji: '' });
    logger.warn(reason, undefined, { emoji: '⚠️' });
    logger.info('Choose your onboarding path:', undefined, { emoji: '📋' });
    logger.info(`1. ${theme.cmd('tinyclaw setup')} ${theme.dim('(CLI wizard)')}`, undefined, {
      emoji: '📋',
    });
    logger.info(`2. ${theme.cmd('tinyclaw setup --web')} ${theme.dim('(Web setup)')}`, undefined, {
      emoji: '📋',
    });
    logger.info('─'.repeat(52), undefined, { emoji: '' });

    // Clean up managers before exiting
    configManager.close();
    try {
      await secretsManager.close();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }

  // Read provider settings from config (fallback to defaults)
  const providerModel = configManager.get<string>('providers.starterBrain.model') ?? DEFAULT_MODEL;
  const providerBaseUrl =
    configManager.get<string>('providers.starterBrain.baseUrl') ?? DEFAULT_BASE_URL;

  // --- Initialize database ----------------------------------------------

  const dbPath = join(dataDir, 'data', 'agent.db');
  const db = createDatabase(dbPath);
  logger.info('Database initialized', undefined, { emoji: '✅' });

  // --- Initialize learning engine ---------------------------------------

  const learningPath = join(dataDir, 'learning');
  const learning = createLearningEngine({ storagePath: learningPath });
  logger.info('Learning engine initialized', undefined, { emoji: '✅' });

  // --- Initialize heartware ---------------------------------------------

  const heartwareConfig: HeartwareConfig = {
    baseDir: join(dataDir, 'heartware'),
    userId: 'default-user',
    auditDir: join(dataDir, 'audit'),
    backupDir: join(dataDir, 'heartware', '.backups'),
    maxFileSize: 1_048_576, // 1 MB
    seed: seedOverride,
  };

  const heartwareManager = new HeartwareManager(heartwareConfig);
  await heartwareManager.initialize();
  logger.info('Heartware initialized', undefined, { emoji: '✅' });

  const heartwareContext = await loadHeartwareContext(heartwareManager);
  logger.info('Heartware context loaded', undefined, { emoji: '✅' });

  // --- Initialize SHIELD.md runtime enforcement -------------------------

  const shieldContent = await loadShieldContent(heartwareManager);
  const shield = shieldContent ? createShieldEngine(shieldContent) : undefined;

  if (shield) {
    logger.info(
      'Shield engine active',
      {
        threats: shield.getThreats().length,
      },
      { emoji: '🛡️' },
    );
  } else {
    logger.info('No SHIELD.md found — shield enforcement disabled', undefined, { emoji: '🛡️' });
  }

  // --- Initialize default provider (reads key from secrets-engine) ------

  const defaultProvider = createOllamaProvider({
    secrets: secretsManager,
    model: providerModel,
    baseUrl: providerBaseUrl,
  });

  // --- Pre-flight: verify provider connectivity -------------------------

  try {
    const reachable = await defaultProvider.isAvailable();
    if (!reachable) {
      console.log();
      console.log(theme.error('  ✖ Cannot reach the default provider.'));
      console.log();
      console.log(`    Provider : ${theme.label(defaultProvider.name)}`);
      console.log(`    Base URL : ${theme.dim(providerBaseUrl)}`);
      console.log();
      console.log('    Possible causes:');
      console.log('      • The provider service may be temporarily down');
      console.log('      • The base URL may be incorrect');
      console.log('      • A firewall or proxy may be blocking the connection');
      console.log();
      console.log(`    Run ${theme.cmd('tinyclaw setup')} to reconfigure your provider.`);
      console.log();
      await secretsManager.close();
      process.exit(1);
    }
  } catch (err) {
    const msg = (err as Error).message ?? '';
    const isAuthError = msg.startsWith('Authentication failed');

    console.log();
    if (isAuthError) {
      console.log(theme.error('  ✖ Provider authentication failed (401).'));
      console.log();
      console.log(`    Provider : ${theme.label(defaultProvider.name)}`);
      console.log(`    Base URL : ${theme.dim(providerBaseUrl)}`);
      console.log();
      console.log('    Your API key may be invalid, expired, or revoked.');
      console.log(`    Run ${theme.cmd('tinyclaw setup')} to enter a new API key.`);
    } else {
      console.log(theme.error('  ✖ Provider connectivity check failed.'));
      console.log();
      console.log(`    Provider : ${theme.label(defaultProvider.name)}`);
      console.log(`    Base URL : ${theme.dim(providerBaseUrl)}`);
      console.log(`    Error    : ${theme.dim(msg)}`);
      console.log();
      console.log(`    Run ${theme.cmd('tinyclaw setup')} to reconfigure your provider.`);
    }
    console.log();
    await secretsManager.close();
    process.exit(1);
  }

  logger.info('Default provider connected and verified', undefined, { emoji: '✅' });

  // --- Load plugins ------------------------------------------------------

  const plugins = await loadPlugins(configManager);
  logger.info(
    'Plugins loaded',
    {
      channels: plugins.channels.length,
      providers: plugins.providers.length,
      tools: plugins.tools.length,
    },
    { emoji: '✅' },
  );

  // --- Initialize plugin providers ---------------------------------------

  const pluginProviders: Provider[] = [];

  for (const pp of plugins.providers) {
    try {
      const provider = await pp.createProvider(secretsManager);
      pluginProviders.push(provider);
      logger.info(`Plugin provider initialized: ${pp.name} (${provider.id})`, undefined, {
        emoji: '✅',
      });
    } catch (err) {
      logger.error(`Failed to initialize provider plugin "${pp.name}":`, err);
    }
  }

  // --- Resolve primary provider (overrides built-in as default) ----------

  // If a primary provider is configured and a matching plugin provider is
  // loaded, it replaces the built-in Ollama provider as the orchestrator's
  // default. The built-in remains registered as the ultimate safety net.

  let routerDefaultProvider: Provider = defaultProvider;
  let activeProviderName = defaultProvider.name;
  let activeModelName = providerModel;

  const primaryModel = configManager.get<string>('providers.primary.model');

  if (primaryModel) {
    // Find a plugin provider whose id matches the primary config.
    // Convention: the provider ID from the plugin is used to look up matching.

    // Try to find a matching plugin provider by checking if any plugin
    // provider's id is referenced in the tier mapping or matches a known pattern.
    // For now, we look for a plugin provider whose model matches.
    const matchingProvider = pluginProviders.find((pp) => {
      // Check if this provider was configured with the primary model
      // Plugin providers set their own id, so we check availability instead
      return pp.id !== defaultProvider.id;
    });

    if (matchingProvider) {
      try {
        const available = await matchingProvider.isAvailable();
        if (available) {
          routerDefaultProvider = matchingProvider;
          activeProviderName = matchingProvider.name;
          activeModelName = primaryModel;
          logger.info(
            'Primary provider active, overriding built-in as default',
            {
              primary: matchingProvider.id,
              model: primaryModel,
            },
            { emoji: '✅' },
          );
        } else {
          logger.warn(
            `Primary provider "${matchingProvider.name}" unavailable, falling back to built-in`,
          );
        }
      } catch {
        logger.warn(`Primary provider health check failed, falling back to built-in`);
      }
    } else {
      logger.warn(
        'Primary provider configured but no matching plugin provider found. ' +
          'Ensure the provider plugin is installed and enabled.',
      );
    }
  }

  // --- Initialize smart routing orchestrator -----------------------------

  const tierMapping = configManager.get<ProviderTierConfig>('routing.tierMapping');

  const orchestrator = new ProviderOrchestrator({
    defaultProvider: routerDefaultProvider,
    providers: [
      // Always include the built-in so it can serve as ultimate fallback
      ...(routerDefaultProvider.id !== defaultProvider.id ? [defaultProvider] : []),
      ...pluginProviders,
    ],
    tierMapping: tierMapping ?? undefined,
  });

  logger.info(
    'Smart routing initialized',
    {
      default: routerDefaultProvider.id,
      providers: orchestrator.getRegistry().ids(),
      tierMapping: tierMapping ?? 'all-default',
    },
    { emoji: '✅' },
  );

  // --- Initialize tools -------------------------------------------------

  const tools = [
    ...createHeartwareTools(heartwareManager),
    ...createSecretsTools(secretsManager),
    ...createConfigTools(configManager),
  ];

  // Merge plugin pairing tools (channels + providers) from enabled plugins
  const enabledPairingTools = [
    ...plugins.channels.flatMap((ch) => ch.getPairingTools?.(secretsManager, configManager) ?? []),
    ...plugins.providers.flatMap((pp) => pp.getPairingTools?.(secretsManager, configManager) ?? []),
  ];

  // Discover pairing tools from installed-but-not-yet-enabled plugins.
  // This solves the chicken-and-egg problem: the agent needs pairing tools
  // (e.g. discord_pair) to activate plugins conversationally, but those tools
  // were previously only loaded from already-enabled plugins.
  const enabledIds = configManager.get<string[]>('plugins.enabled') ?? [];
  const discoveredPairingTools = await discoverPairingTools(
    enabledIds,
    secretsManager,
    configManager,
  );

  if (discoveredPairingTools.length > 0) {
    logger.info(
      'Discovered pairing tools from available plugins',
      { count: discoveredPairingTools.length, tools: discoveredPairingTools.map((t) => t.name) },
      { emoji: '🔌' },
    );
  }

  const pairingTools = [...enabledPairingTools, ...discoveredPairingTools];

  // Create a temporary context for plugin tools that need AgentContext
  const baseContext = {
    db,
    provider: routerDefaultProvider,
    learning,
    tools,
    heartwareContext,
    secrets: secretsManager,
    configManager,
  };

  const pluginTools = plugins.tools.flatMap((tp) => tp.createTools(baseContext));

  const allTools = [...tools, ...pairingTools, ...pluginTools];

  // --- Initialize session queue (before delegation — background runner needs it) --

  const queue = createSessionQueue();
  logger.info('Session queue initialized', undefined, { emoji: '✅' });

  // --- Initialize v3 subsystems ------------------------------------------

  // Intercom (before delegation — delegation emits events)
  const intercom = createIntercom();
  logger.info('Intercom initialized', undefined, { emoji: '✅' });

  // Memory engine (after db — uses episodic_memory + memory_fts tables)
  const memoryEngine = createMemoryEngine(db);
  logger.info('Memory engine initialized (episodic + FTS5 + temporal decay)', undefined, {
    emoji: '✅',
  });

  // Compactor (after db — uses compactions table, configurable via config engine)
  const compactorConfig = {
    threshold: configManager.get<number>('compaction.threshold') ?? undefined,
    keepRecent: configManager.get<number>('compaction.keepRecent') ?? undefined,
    tierBudgets: {
      l0: configManager.get<number>('compaction.tierBudgets.l0') ?? undefined,
      l1: configManager.get<number>('compaction.tierBudgets.l1') ?? undefined,
      l2: configManager.get<number>('compaction.tierBudgets.l2') ?? undefined,
    },
    dedup: {
      enabled: configManager.get<boolean>('compaction.dedup.enabled') ?? undefined,
      similarityThreshold:
        configManager.get<number>('compaction.dedup.similarityThreshold') ?? undefined,
    },
    preCompression: {
      stripEmoji: configManager.get<boolean>('compaction.preCompression.stripEmoji') ?? undefined,
      removeDuplicateLines:
        configManager.get<boolean>('compaction.preCompression.removeDuplicateLines') ?? undefined,
    },
  };
  // Remove undefined values so defaults apply
  const cleanConfig = JSON.parse(JSON.stringify(compactorConfig));
  const compactor = createCompactor(db, cleanConfig);
  logger.info('Compactor initialized (tiered compression + dedup + pre-compression)', undefined, {
    emoji: '✅',
  });

  // Timeout estimator (after db — uses task_metrics table)
  const timeoutEstimator = createTimeoutEstimator(db);
  logger.info('Timeout estimator initialized', undefined, { emoji: '✅' });

  // Code execution sandbox
  const sandbox = createSandbox();
  logger.info('Sandbox initialized', undefined, { emoji: '✅' });

  // Blackboard (after db + intercom)
  const blackboard = createBlackboard(db, intercom);
  logger.info('Blackboard initialized', undefined, { emoji: '✅' });

  // Shell engine — permission-controlled shell execution
  const shellAllowPatterns = configManager.get<string[]>('shell.allowPatterns') ?? [];
  const shell = createShellEngine({
    workingDirectory: process.cwd(),
    allowPatterns: shellAllowPatterns,
  });
  const shellTools = createShellTools(shell);
  allTools.push(...shellTools);
  logger.info(
    'Shell engine initialized',
    { allowPatterns: shellAllowPatterns.length },
    { emoji: '✅' },
  );

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
        input: {
          type: 'string',
          description:
            'Optional data to pass as the `input` variable in the sandbox (use JSON string for complex data)',
        },
        timeout: { type: 'number', description: 'Override timeout in ms (max 30s)' },
      },
      required: ['code'],
    },
    async execute(args) {
      const code = String(args.code || '');
      if (!code) return 'Error: code is required.';

      const timeout = args.timeout ? Math.min(Number(args.timeout), 30_000) : undefined;
      const input = args.input;

      const result =
        input !== undefined
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
      'Gracefully restart Tiny Claw. Use this after configuration changes that ' +
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
      logger.info(`Restart requested: ${reason}`, undefined, { emoji: '🔄' });

      // Give a short delay so the response can be sent to the user
      setTimeout(() => {
        process.exit(RESTART_EXIT_CODE);
      }, 500);

      return (
        'Restart initiated. Tiny Claw will shut down and automatically respawn ' +
        'with the updated configuration in a few seconds.'
      );
    },
  };

  allTools.push(restartTool);

  // builtin_model_switch tool — allows the agent to switch between built-in models
  const modelSwitchTool: Tool = {
    name: 'builtin_model_switch',
    description:
      'Switch the built-in Ollama Cloud model. Available models: ' +
      BUILTIN_MODEL_TAGS.join(', ') +
      '. ' +
      'This updates the configuration and triggers a restart so the new model ' +
      'takes effect. Always warn the user before calling this — they will ' +
      'briefly lose connectivity during the restart.',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: `Model tag to switch to. One of: ${BUILTIN_MODEL_TAGS.join(', ')}`,
          enum: [...BUILTIN_MODEL_TAGS],
        },
      },
      required: ['model'],
    },
    async execute(args) {
      const model = (args.model as string)?.trim();

      if (!BUILTIN_MODEL_TAGS.includes(model as (typeof BUILTIN_MODEL_TAGS)[number])) {
        return `Invalid model "${model}". Available built-in models: ${BUILTIN_MODEL_TAGS.join(', ')}`;
      }

      if (model === providerModel) {
        return `Already running on ${model} — no switch needed.`;
      }

      // Persist the new model choice
      configManager.set('providers.starterBrain.model', model);
      logger.info(`Model switch: ${providerModel} → ${model}`, undefined, { emoji: '🔄' });

      // Trigger restart so the new model takes effect
      setTimeout(() => {
        process.exit(RESTART_EXIT_CODE);
      }, 500);

      return (
        `Switching from ${providerModel} to ${model}. ` +
        'Tiny Claw will restart in a few seconds with the new model.'
      );
    },
  };

  allTools.push(modelSwitchTool);

  // primary_model_list tool — shows all installed provider plugins
  const providerListTool: Tool = {
    name: 'primary_model_list',
    description:
      'List all installed provider plugins and show which one is the primary provider. ' +
      "Shows each provider's ID, name, and availability status. " +
      'The built-in Ollama Cloud provider is always available as the fallback.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute() {
      const currentPrimary = configManager.get<string>('providers.primary.model');
      const lines: string[] = [];

      // Built-in provider
      lines.push('Built-in Provider (always available as fallback):');
      lines.push(`  • ${defaultProvider.name} (${defaultProvider.id})`);
      lines.push(`    Model: ${providerModel}`);
      lines.push(
        `    Status: ${currentPrimary ? 'standby (primary is active)' : 'active (default)'}`,
      );
      lines.push('');

      if (pluginProviders.length === 0) {
        lines.push('No provider plugins installed.');
        lines.push('');
        lines.push(
          'To install a provider plugin, add it to plugins.enabled in the config and restart.',
        );
      } else {
        lines.push(`Installed Provider Plugins (${pluginProviders.length}):`);

        for (const pp of pluginProviders) {
          const isPrimary = routerDefaultProvider.id === pp.id;
          let status = 'available';
          try {
            const avail = await pp.isAvailable();
            status = avail ? 'available' : 'unavailable';
          } catch {
            status = 'unavailable';
          }

          const primaryTag = isPrimary ? ' [PRIMARY]' : '';
          lines.push(`  • ${pp.name} (${pp.id})${primaryTag}`);
          lines.push(`    Status: ${status}`);
        }

        if (!currentPrimary) {
          lines.push('');
          lines.push('No primary provider is set. Use primary_model_set to set one.');
        }
      }

      return lines.join('\n');
    },
  };

  allTools.push(providerListTool);

  // primary_model_set tool — set an installed plugin provider as primary
  const providerSetPrimaryTool: Tool = {
    name: 'primary_model_set',
    description:
      'Set an installed provider plugin as the primary provider. ' +
      'The primary provider overrides the built-in Ollama Cloud as the default ' +
      'provider in the smart router. The built-in remains as the fallback if ' +
      'the primary becomes unavailable. ' +
      'Use primary_model_list first to see available providers. ' +
      'This triggers a restart so the change takes effect. ' +
      'Always confirm with the user before calling this.',
    parameters: {
      type: 'object',
      properties: {
        provider_id: {
          type: 'string',
          description:
            'The ID of the installed provider plugin to set as primary (from primary_model_list)',
        },
      },
      required: ['provider_id'],
    },
    async execute(args) {
      const providerId = (args.provider_id as string)?.trim();

      if (!providerId) {
        return 'Error: provider_id is required. Use primary_model_list to see available providers.';
      }

      // Cannot set built-in as primary (it's always the fallback)
      if (providerId === defaultProvider.id) {
        return (
          `"${providerId}" is the built-in provider and is always available as the fallback. ` +
          'Use primary_model_clear to revert to using the built-in as default.'
        );
      }

      // Find the matching plugin provider
      const target = pluginProviders.find((pp) => pp.id === providerId);

      if (!target) {
        const available = pluginProviders.map((pp) => pp.id).join(', ');
        return (
          `Provider "${providerId}" is not installed. ` +
          (available ? `Available providers: ${available}` : 'No provider plugins are installed.')
        );
      }

      // Verify it's reachable
      try {
        const available = await target.isAvailable();
        if (!available) {
          return (
            `Provider "${target.name}" (${target.id}) is currently unavailable. ` +
            'Make sure it is properly configured with a valid API key before setting it as primary.'
          );
        }
      } catch (err) {
        return (
          `Provider "${target.name}" health check failed: ${(err as Error).message}. ` +
          'Ensure the provider is properly configured before setting it as primary.'
        );
      }

      // Persist primary config
      configManager.set('providers.primary', {
        model: target.id,
        baseUrl: undefined,
        apiKeyRef: undefined,
      });

      logger.info(`Primary provider set: ${target.name} (${target.id})`, undefined, {
        emoji: '🔄',
      });

      // Trigger restart
      setTimeout(() => {
        process.exit(RESTART_EXIT_CODE);
      }, 500);

      return (
        `Primary provider set to "${target.name}" (${target.id}). ` +
        'Tiny Claw will restart in a few seconds. ' +
        'The smart router will use this provider as the default instead of the built-in.'
      );
    },
  };

  allTools.push(providerSetPrimaryTool);

  // primary_model_clear tool — remove primary override, revert to built-in
  const providerClearPrimaryTool: Tool = {
    name: 'primary_model_clear',
    description:
      'Remove the primary provider override and revert to using the built-in ' +
      'Ollama Cloud provider as the default. The cleared provider plugin remains ' +
      'installed and can still be used via tier mapping in the smart router. ' +
      'This triggers a restart so the change takes effect. ' +
      'Always confirm with the user before calling this.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute() {
      const currentPrimary = configManager.get<string>('providers.primary.model');

      if (!currentPrimary) {
        return 'No primary provider is currently set. The built-in is already the default.';
      }

      configManager.delete('providers.primary');
      logger.info('Primary provider cleared, reverting to built-in', undefined, { emoji: '🔄' });

      // Trigger restart
      setTimeout(() => {
        process.exit(RESTART_EXIT_CODE);
      }, 500);

      return (
        'Primary provider cleared. Tiny Claw will restart in a few seconds ' +
        'and use the built-in Ollama Cloud provider as the default.'
      );
    },
  };

  allTools.push(providerClearPrimaryTool);

  // plugin_install tool — allows the agent to install community plugins conversationally
  const pluginInstallTool: Tool = {
    name: 'plugin_install',
    description:
      'Install a community plugin from npm by package name. The user can paste ' +
      'an npm package name (e.g. "@acme/tinyclaw-plugin-telegram" or ' +
      '"tinyclaw-plugin-notion") and this tool will install it, validate it is ' +
      'a valid Tiny Claw plugin, and register it. After successful installation, ' +
      'call tinyclaw_restart to activate the plugin. ' +
      'IMPORTANT: Always confirm with the user before installing. Warn them that ' +
      'community plugins are unverified third-party code that will execute on ' +
      'their machine. ' +
      'Official @tinyclaw/plugin-* packages are managed separately and cannot ' +
      'be installed through this tool.',
    parameters: {
      type: 'object',
      properties: {
        package_name: {
          type: 'string',
          description: 'The npm package name to install (e.g. "@acme/tinyclaw-plugin-telegram")',
        },
      },
      required: ['package_name'],
    },
    async execute(args) {
      const packageName = (args.package_name as string)?.trim();
      if (!packageName) {
        return 'Error: package_name is required. Ask the user for the npm package name.';
      }

      const result = await installCommunityPlugin(packageName, configManager);

      if (result.success && result.plugin) {
        return (
          `${result.message}\n\n` +
          `Plugin details:\n` +
          `  Name: ${result.plugin.name}\n` +
          `  ID: ${result.plugin.id}\n` +
          `  Type: ${result.plugin.type}\n` +
          `  Version: ${result.plugin.version}\n` +
          `  Source: community (unverified)\n\n` +
          'Call tinyclaw_restart to activate the plugin.'
        );
      }

      return result.message;
    },
  };

  allTools.push(pluginInstallTool);

  // plugin_remove tool — allows the agent to remove community plugins
  const pluginRemoveTool: Tool = {
    name: 'plugin_remove',
    description:
      'Remove a community plugin. This unregisters the plugin from config, ' +
      'removes it from the enabled list, and uninstalls the npm package. ' +
      'After removal, call tinyclaw_restart to apply changes. ' +
      'Only works for community plugins — official @tinyclaw/plugin-* ' +
      'packages cannot be removed through this tool.',
    parameters: {
      type: 'object',
      properties: {
        package_name: {
          type: 'string',
          description: 'The npm package name of the community plugin to remove',
        },
      },
      required: ['package_name'],
    },
    async execute(args) {
      const packageName = (args.package_name as string)?.trim();
      if (!packageName) {
        return 'Error: package_name is required.';
      }

      const result = await removeCommunityPlugin(packageName, configManager);
      return result.message;
    },
  };

  allTools.push(pluginRemoveTool);

  // plugin_list tool — shows all plugins (official + community)
  const pluginListTool: Tool = {
    name: 'plugin_list',
    description:
      'List all installed plugins — both official (@tinyclaw/plugin-*) and ' +
      "community plugins. Shows each plugin's name, type, version, enabled " +
      'status, and source (official or community).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute() {
      const enabledIds = configManager.get<string[]>('plugins.enabled') ?? [];
      const lines: string[] = [];

      // Official plugins — show enabled ones, plus note about discoverable ones
      const officialEnabled = enabledIds.filter((id) => id.startsWith('@tinyclaw/plugin-'));
      lines.push('Official Plugins (verified @tinyclaw/plugin-*):');
      if (officialEnabled.length > 0) {
        for (const id of officialEnabled) {
          try {
            const mod = await import(id);
            const p = mod.default;
            lines.push(
              `  • ${p?.name ?? id} (${id}) v${p?.version ?? '?'} — ${p?.type ?? '?'} [enabled]`,
            );
          } catch {
            lines.push(`  • ${id} [enabled, but failed to load]`);
          }
        }
      } else {
        lines.push('  (none enabled)');
      }
      lines.push(
        '  Note: Official plugins not yet enabled are discovered automatically — ask me to pair one.',
      );

      lines.push('');

      // Community plugins
      const communityPlugins = await listCommunityPlugins(configManager);
      lines.push('Community Plugins (unverified):');
      if (communityPlugins.length > 0) {
        for (const cp of communityPlugins) {
          const status = cp.enabled ? 'enabled' : 'installed';
          lines.push(`  • ${cp.name} (${cp.id}) v${cp.version} — ${cp.type} [${status}]`);
        }
      } else {
        lines.push('  (none installed)');
        lines.push('');
        lines.push(
          'To install a community plugin, the user can provide an npm package name ' +
            'and you can use plugin_install to add it.',
        );
      }

      return lines.join('\n');
    },
  };

  allTools.push(pluginListTool);

  // --- Create delegation v2 subsystems -----------------------------------

  const delegationResult = createDelegationTools({
    orchestrator,
    allTools,
    db,
    heartwareContext,
    learning,
    queue,
    timeoutEstimator,
    intercom,
    getCompactedContext: (userId: string) => compactor.getLatestSummary(userId),
  });

  const allToolsWithDelegation = [...allTools, ...delegationResult.tools];
  logger.info('Loaded tools', { count: allToolsWithDelegation.length }, { emoji: '✅' });

  // --- Cleanup idle sub-agents from previous sessions --------------------
  // Sub-agents that are still 'active' but have no running tasks are stale
  // leftovers. Suspend them so the UI doesn't show orphaned idle agents.
  {
    const activeAgents = db.getActiveSubAgents('default-user');
    const allTasks = db.getUserBackgroundTasks('default-user');
    let suspended = 0;
    for (const agent of activeAgents) {
      const hasRunning = allTasks.some((t) => t.agentId === agent.id && t.status === 'running');
      if (!hasRunning) {
        delegationResult.lifecycle.suspend(agent.id);
        suspended++;
      }
    }
    if (suspended > 0) {
      logger.info('Suspended idle sub-agents from previous session', { count: suspended });
    }
  }

  // --- Create agent context ---------------------------------------------

  // Load persisted owner ID (if already claimed)
  const persistedOwnerId = configManager.get<string>('owner.ownerId');

  // --- Check for software updates (non-blocking) -------------------------

  let updateContext: string | undefined;
  try {
    const { getVersion } = await import('../ui/banner.js');
    const currentVersion = getVersion();
    const updateInfo = await checkForUpdate(currentVersion, dataDir);
    const ctx = buildUpdateContext(updateInfo);
    if (ctx) updateContext = ctx;
  } catch (err) {
    logger.debug('Update check skipped', err);
  }

  // Check for plugin updates (non-blocking, same pattern as core)
  try {
    const communityIds = getCommunityPlugins(configManager);
    const pluginUpdateInfo = await checkPluginUpdates(dataDir, communityIds);
    const pluginCtx = buildPluginUpdateContext(pluginUpdateInfo);
    if (pluginCtx) {
      updateContext = (updateContext ?? '') + pluginCtx;
    }
  } catch (err) {
    logger.debug('Plugin update check skipped', err);
  }

  const context = {
    db,
    provider: routerDefaultProvider,
    learning,
    tools: allToolsWithDelegation,
    heartwareContext,
    secrets: secretsManager,
    configManager,
    modelName: activeModelName,
    providerName: activeProviderName,
    delegation: {
      lifecycle: delegationResult.lifecycle,
      templates: delegationResult.templates,
      background: delegationResult.background,
    },
    memory: memoryEngine,
    shield,
    compactor,
    ownerId: persistedOwnerId || undefined,
    updateContext,
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

  // Proactive check-in — periodically prompts the AI to reflect and prepare
  // a helpful update for the owner. Runs on start and every 6 hours.
  pulse.register({
    id: 'proactive-checkin',
    schedule: '6h',
    runOnStart: true,
    handler: async () => {
      const ownerId = configManager.get<string>('owner.ownerId');
      if (!ownerId) return; // No owner claimed yet

      // Only run if the owner has at least 1 past conversation
      const history = db.getHistory(ownerId, 1);
      if (history.length === 0) return; // First boot — welcome handled by web UI

      await queue.enqueue('pulse:proactive', async () => {
        await agentLoop(
          '[SYSTEM: This is a proactive check-in. Review your memory, recent logs, and any pending tasks. ' +
            'Prepare a brief, useful status update or helpful suggestion for your owner. ' +
            'Think about: what tasks are pending, what you learned recently, and what might be helpful to share. ' +
            'Save any insights to your daily log. Do NOT respond conversationally — just update your internal state.]',
          'pulse:proactive',
          context,
        );
      });
    },
  });

  pulse.start();
  logger.info('Pulse scheduler initialized', undefined, { emoji: '✅' });

  // --- Auto-build Web UI if needed --------------------------------------

  // Resolve web package root by finding @tinyclaw/web's entry point
  // @tinyclaw/web exports src/server.ts → its parent dir is src/web/
  let webRoot: string;
  try {
    const uiEntry = require.resolve('@tinyclaw/web');
    webRoot = resolve(uiEntry, '..', '..');
  } catch {
    // Fallback 1: resolve relative to cwd (when running from the project root)
    const cwdCandidate = resolve(process.cwd(), 'src', 'web');
    if (existsSync(cwdCandidate)) {
      webRoot = cwdCandidate;
    } else {
      // Fallback 2: resolve relative to this file (src/cli/src/commands/ → src/web/)
      webRoot = resolve(import.meta.dir, '..', '..', '..', 'web');
    }
  }
  const webDistIndex = join(webRoot, 'dist', 'index.html');

  // Check if build is missing OR stale (source newer than dist)
  let needsBuild = !existsSync(webDistIndex);
  if (!needsBuild) {
    try {
      const distMtime = statSync(webDistIndex).mtimeMs;
      const srcDir = join(webRoot, 'src');
      // Check if any source file is newer than the dist output
      const checkDir = (dir: string): boolean => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (checkDir(fullPath)) return true;
          } else if (statSync(fullPath).mtimeMs > distMtime) {
            return true;
          }
        }
        return false;
      };
      if (existsSync(srcDir)) {
        needsBuild = checkDir(srcDir);
      }
    } catch {
      // If stat check fails, skip stale detection
    }
  }

  if (needsBuild) {
    if (!existsSync(webRoot)) {
      logger.warn(`Web UI source not found at ${webRoot} — skipping build`, undefined, {
        emoji: '⚠️',
      });
    } else {
      logger.info('Web UI build needed — building now...', undefined, { emoji: '🔨' });
      try {
        const buildResult = Bun.spawnSync([process.execPath, 'run', 'build'], {
          cwd: webRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        if (buildResult.exitCode === 0) {
          logger.info('Web UI built successfully', undefined, { emoji: '✅' });
        } else {
          const stderr = buildResult.stderr?.toString().trim();
          logger.warn('Web UI build failed — dashboard will show setup instructions', undefined, {
            emoji: '⚠️',
          });
          if (stderr) logger.warn(stderr);
        }
      } catch (err) {
        logger.warn('Could not build Web UI:', err, { emoji: '⚠️' });
      }
    }
  }

  // --- Start Web UI / API server ----------------------------------------

  const port = parseInt(process.env.PORT || '3000', 10);
  const webUI = createWebUI({
    port,
    webRoot,
    configManager,
    secretsManager,
    configDbPath: configManager.path,
    dataDir,
    onOwnerClaimed: (ownerId: string) => {
      // Update context at runtime when ownership is claimed
      (context as { ownerId?: string }).ownerId = ownerId;
      logger.info('Owner claimed via web UI', { ownerId }, { emoji: '🔑' });
    },
    onMessage: async (message: string, userId: string) => {
      // Update companion activity tracker on every user message
      touchCompanionActivity?.();
      const { provider, classification, failedOver } = await orchestrator.routeWithHealth(message);
      logger.debug('Routed query', {
        tier: classification.tier,
        provider: provider.id,
        confidence: classification.confidence.toFixed(2),
        failedOver,
      });
      const routedContext = { ...context, provider };
      return await queue.enqueue(userId, () => agentLoop(message, userId, routedContext));
    },
    getBackgroundTasks: (userId: string) => {
      return delegationResult.background.getAll(userId);
    },
    getSubAgents: (userId: string) => {
      // Include soft_deleted agents so the sidebar can show history
      return db.getAllSubAgents(userId, true);
    },
    onMessageStream: async (message: string, userId: string, callback: StreamCallback) => {
      // Update companion activity tracker on every user message
      touchCompanionActivity?.();
      const { provider, classification, failedOver } = await orchestrator.routeWithHealth(message);
      logger.debug('Routed query (stream)', {
        tier: classification.tier,
        provider: provider.id,
        failedOver,
      });
      const routedContext = { ...context, provider };
      await queue.enqueue(userId, () => agentLoop(message, userId, routedContext, callback));
    },
  });

  await webUI.start();

  // --- Outbound Gateway ---------------------------------------------------

  const gateway = createGateway();

  // Register web UI as a channel sender (SSE push)
  gateway.register('web', webUI.getChannelSender());

  // --- Nudge Engine -------------------------------------------------------

  const nudgePrefs = {
    enabled: configManager.get<boolean>('nudge.enabled') ?? true,
    quietHoursStart: configManager.get<string>('nudge.quietHoursStart'),
    quietHoursEnd: configManager.get<string>('nudge.quietHoursEnd'),
    maxPerHour: configManager.get<number>('nudge.maxPerHour') ?? 5,
    suppressedCategories: (configManager.get<string[]>('nudge.suppressedCategories') ??
      []) as import('@tinyclaw/types').NudgeCategory[],
  };

  const nudgeEngine = createNudgeEngine({ gateway, preferences: nudgePrefs });
  const unwireNudge = wireNudgeToIntercom(nudgeEngine, intercom);

  // Register nudge tools so the agent can proactively reach out
  allToolsWithDelegation.push(...createNudgeTools(nudgeEngine));

  logger.info('Nudge engine initialized', undefined, { emoji: '✅' });

  // Sync nudge preferences when config changes
  configManager.onDidAnyChange(() => {
    nudgeEngine.setPreferences({
      enabled: configManager.get<boolean>('nudge.enabled') ?? true,
      quietHoursStart: configManager.get<string>('nudge.quietHoursStart'),
      quietHoursEnd: configManager.get<string>('nudge.quietHoursEnd'),
      maxPerHour: configManager.get<number>('nudge.maxPerHour') ?? 5,
      suppressedCategories: (configManager.get<string[]>('nudge.suppressedCategories') ??
        []) as import('@tinyclaw/types').NudgeCategory[],
    });
  });

  // Register nudge flush job with Pulse (every 1 minute)
  pulse.register({
    id: 'nudge-flush',
    schedule: '1m',
    handler: async () => {
      await nudgeEngine.flush();
    },
  });

  // --- Companion Nudges (AI-generated, Heartware-aligned) ----------------

  const companionJobs = createCompanionJobs({
    nudgeEngine,
    queue,
    context,
    configManager,
    db,
    agentLoop,
  });

  for (const job of companionJobs) {
    pulse.register(job);
  }

  // Wire activity tracking so the companion knows when the owner is active
  const touchCompanionActivity = getCompanionTouchActivity(companionJobs);

  logger.info('Companion nudges registered', undefined, { emoji: '🐾' });

  // Register software update check nudge (every 6 hours)
  pulse.register({
    id: 'nudge-update-check',
    schedule: '6h',
    handler: async () => {
      try {
        const { getVersion } = await import('../ui/banner.js');
        const currentVersion = getVersion();
        const updateInfo = await checkForUpdate(currentVersion, dataDir);
        if (!updateInfo?.updateAvailable) return;

        // Deduplicate: skip if a pending nudge already exists for this version
        const pending = nudgeEngine.pending();
        const alreadyQueued = pending.some(
          (n) =>
            n.category === 'software_update' && n.metadata?.latestVersion === updateInfo.latest,
        );
        if (alreadyQueued) return;

        const ownerId = configManager.get<string>('owner.ownerId') || 'web:default';
        nudgeEngine.schedule({
          userId: ownerId,
          category: 'software_update',
          content: `Tiny Claw ${updateInfo.latest} is available (you're on ${updateInfo.current}). Check the release notes at ${updateInfo.releaseUrl}`,
          priority: 'low',
          deliverAfter: 0,
          metadata: {
            currentVersion: updateInfo.current,
            latestVersion: updateInfo.latest,
            runtime: updateInfo.runtime,
            releaseUrl: updateInfo.releaseUrl,
          },
        });

        logger.info('Nudge: software update scheduled', {
          current: updateInfo.current,
          latest: updateInfo.latest,
        });
      } catch (err) {
        logger.debug('Nudge: update check skipped', err);
      }
    },
  });

  // Register plugin update check nudge (every 6 hours, same cadence as core)
  pulse.register({
    id: 'nudge-plugin-update-check',
    schedule: '6h',
    handler: async () => {
      try {
        const pluginUpdateInfo = await checkPluginUpdates(
          dataDir,
          getCommunityPlugins(configManager),
        );
        if (!pluginUpdateInfo || pluginUpdateInfo.updatableCount === 0) return;

        const updatable = pluginUpdateInfo.plugins.filter((p) => p.updateAvailable);

        // Deduplicate: skip if a pending nudge already covers these plugins
        const pending = nudgeEngine.pending();
        const alreadyQueued = pending.some((n) => n.category === 'plugin_update');
        if (alreadyQueued) return;

        const pluginList = updatable.map((p) => `${p.id} ${p.current} → ${p.latest}`).join(', ');

        const ownerId = configManager.get<string>('owner.ownerId') || 'web:default';
        nudgeEngine.schedule({
          userId: ownerId,
          category: 'plugin_update',
          content: `Plugin updates available: ${pluginList}`,
          priority: 'low',
          deliverAfter: 0,
          metadata: {
            updatableCount: pluginUpdateInfo.updatableCount,
            plugins: updatable.map((p) => ({
              id: p.id,
              current: p.current,
              latest: p.latest,
            })),
            runtime: pluginUpdateInfo.runtime,
          },
        });

        logger.info('Nudge: plugin update scheduled', {
          count: pluginUpdateInfo.updatableCount,
          plugins: pluginList,
        });
      } catch (err) {
        logger.debug('Nudge: plugin update check skipped', err);
      }
    },
  });

  // --- Start channel plugins ---------------------------------------------

  const pluginRuntimeContext = {
    enqueue: async (userId: string, message: string) => {
      const { provider } = await orchestrator.routeWithHealth(message);
      const routedContext = { ...context, provider };
      return queue.enqueue(userId, () => agentLoop(message, userId, routedContext));
    },
    agentContext: context,
    secrets: secretsManager,
    configManager,
    gateway,
  };

  for (const channel of plugins.channels) {
    try {
      await channel.start(pluginRuntimeContext);
      logger.info(`Channel plugin started: ${channel.name}`, undefined, { emoji: '✅' });

      // Register channel plugins that support outbound messaging
      if (channel.sendToUser && channel.channelPrefix) {
        gateway.register(channel.channelPrefix, {
          name: channel.name,
          async send(userId, message) {
            await channel.sendToUser(userId, message);
          },
        });
      }
    } catch (err) {
      logger.error(`Failed to start channel plugin "${channel.name}":`, err);
    }
  }

  const stats = learning.getStats();
  logger.log(`Learning: ${stats.totalPatterns} patterns learned`, undefined, { emoji: '🧠' });
  logger.log('');
  logger.log('Tiny Claw is ready!', undefined, { emoji: '🎉' });
  logger.info(`API server: http://localhost:${port}`, undefined, { emoji: '🌐' });
  logger.debug('Web UI: Run "bun run dev:ui" then open http://localhost:5173', undefined, {
    emoji: '🔧',
  });
  logger.log('');

  // --- Graceful shutdown ------------------------------------------------

  let isShuttingDown = false;

  process.on('SIGINT', async () => {
    if (isShuttingDown) {
      logger.info('Shutdown already in progress, ignoring signal');
      return;
    }
    isShuttingDown = true;
    logger.info('Shutting down Tiny Claw...', undefined, { emoji: '👋' });

    // 0. Pulse scheduler + session queue
    try {
      pulse.stop();
      queue.stop();
      logger.info('Pulse scheduler and session queue stopped');
    } catch (err) {
      logger.error('Error stopping pulse/queue:', err);
    }

    // 0.1. Nudge engine
    try {
      unwireNudge();
      nudgeEngine.stop();
      logger.info('Nudge engine stopped');
    } catch (err) {
      logger.error('Error stopping nudge engine:', err);
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

    // 0.555. Shell engine shutdown — clear session approvals
    try {
      shell.shutdown();
      logger.info('Shell engine shut down');
    } catch (err) {
      logger.error('Error shutting down shell:', err);
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
      const webClosable = webUI as unknown as Record<string, unknown>;
      if (typeof webClosable.stop === 'function') {
        await (webClosable.stop as () => Promise<void>)();
      } else if (typeof webClosable.close === 'function') {
        await (webClosable.close as () => Promise<void>)();
      }
      logger.info('Web UI stopped');
    } catch (err) {
      logger.error('Error stopping Web UI:', err);
    }

    // 2. Learning engine
    try {
      const learningClosable = learning as unknown as Record<string, unknown>;
      if (typeof learningClosable.close === 'function') {
        await (learningClosable.close as () => Promise<void>)();
      }
      logger.info('Learning engine closed');
    } catch (err) {
      logger.error('Error closing learning engine:', err);
    }

    // 3. Heartware
    try {
      const heartwareClosable = heartwareManager as unknown as Record<string, unknown>;
      if (typeof heartwareClosable.close === 'function') {
        await (heartwareClosable.close as () => Promise<void>)();
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
