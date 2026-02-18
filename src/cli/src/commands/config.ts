/**
 * Config Command
 *
 * CLI interface for managing Tiny Claw configuration - models, providers,
 * logging, and routing settings.
 *
 * Usage:
 *   tinyclaw config model                 Show current model configuration
 *   tinyclaw config model list            List available built-in models
 *   tinyclaw config model builtin <tag>   Switch the built-in model
 *   tinyclaw config model primary         Show current primary provider
 *   tinyclaw config model primary clear   Remove primary provider override
 *   tinyclaw config logging               Show current log level
 *   tinyclaw config logging <level>       Set log level (debug|info|warn|error|silent)
 *
 * Two-tier model hierarchy:
 *   - Built-in (Ollama Cloud) = free fallback, always available
 *   - Primary (plugin provider) = overrides built-in as the default
 *     provider in the smart router
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@tinyclaw/config';
import {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  BUILTIN_MODELS,
  BUILTIN_MODEL_TAGS,
} from '@tinyclaw/core';
import { theme } from '../ui/theme.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valid log levels matching the Zod schema in @tinyclaw/config. */
const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

function printUsage(): void {
  console.log();
  console.log('  ' + theme.label('Usage'));
  console.log(`    ${theme.cmd('tinyclaw config model')}                 Show current model configuration`);
  console.log(`    ${theme.cmd('tinyclaw config model list')}            List available built-in models`);
  console.log(`    ${theme.cmd('tinyclaw config model builtin')} <tag>   Switch the built-in model`);
  console.log(`    ${theme.cmd('tinyclaw config model primary')}         Show current primary provider`);
  console.log(`    ${theme.cmd('tinyclaw config model primary clear')}   Remove primary provider override`);
  console.log();
  console.log(`    ${theme.cmd('tinyclaw config logging')}               Show current log level`);
  console.log(`    ${theme.cmd('tinyclaw config logging')} <level>       Set log level (debug|info|warn|error|silent)`);
  console.log();
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/**
 * `tinyclaw config model` - Show current model configuration
 */
async function showModelConfig(configManager: ConfigManager): Promise<void> {
  const builtinModel = configManager.get<string>('providers.starterBrain.model') ?? DEFAULT_MODEL;
  const builtinBaseUrl = configManager.get<string>('providers.starterBrain.baseUrl') ?? DEFAULT_BASE_URL;

  const primaryModel = configManager.get<string>('providers.primary.model');
  const primaryBaseUrl = configManager.get<string>('providers.primary.baseUrl');

  console.log();
  console.log('  ' + theme.label('Model Configuration'));
  console.log();

  // Built-in section
  console.log(`  ${theme.label('Built-in')} ${theme.dim('(Ollama Cloud - always available as fallback)')}`);
  console.log(`    Model    : ${theme.brand(builtinModel)}`);
  console.log(`    Base URL : ${theme.dim(builtinBaseUrl)}`);
  console.log();

  // Primary section
  if (primaryModel) {
    console.log(`  ${theme.label('Primary')} ${theme.dim('(overrides built-in as default provider)')}`);
    console.log(`    Model    : ${theme.brand(primaryModel)}`);
    if (primaryBaseUrl) {
      console.log(`    Base URL : ${theme.dim(primaryBaseUrl)}`);
    }
    console.log();
    console.log(`  ${theme.dim('The smart router uses Primary as the default provider.')}`);
    console.log(`  ${theme.dim('Built-in is the fallback if Primary becomes unavailable.')}`);
  } else {
    console.log(`  ${theme.label('Primary')} ${theme.dim('(not configured)')}`);
    console.log(`    No primary provider set. Built-in is used as the default.`);
    console.log();
    console.log(`  ${theme.dim('To add a primary provider, install a provider plugin and')}`);
    console.log(`  ${theme.dim('ask Tiny Claw to set it as primary. You can also tell Tiny Claw:')}`);
    console.log(`  ${theme.dim('"list my providers" or "set OpenAI as my primary provider"')}`);
  }

  console.log();
}

/**
 * `tinyclaw config model list` - List available built-in models
 */
async function listModels(configManager: ConfigManager): Promise<void> {
  const currentModel = configManager.get<string>('providers.starterBrain.model') ?? DEFAULT_MODEL;

  console.log();
  console.log('  ' + theme.label('Available Built-in Models'));
  console.log();

  for (const model of BUILTIN_MODELS) {
    const isCurrent = model.value === currentModel;
    const marker = isCurrent ? theme.success('●') : theme.dim('○');
    const name = isCurrent ? theme.brand(model.value) : model.value;
    const hint = theme.dim(model.hint);

    console.log(`  ${marker} ${name}`);
    console.log(`    ${hint}`);
  }

  console.log();
  console.log(`  ${theme.dim('Switch with:')} ${theme.cmd('tinyclaw config model builtin <tag>')}`);
  console.log();
}

/**
 * `tinyclaw config model builtin <tag>` - Switch the built-in model
 */
async function switchBuiltinModel(configManager: ConfigManager, tag: string): Promise<void> {
  // Validate the tag
  if (!(BUILTIN_MODEL_TAGS as readonly string[]).includes(tag)) {
    console.log();
    console.log(theme.error(`  ✖ Unknown model: ${tag}`));
    console.log();
    console.log(`  Available models:`);
    for (const t of BUILTIN_MODEL_TAGS) {
      console.log(`    ${theme.dim('•')} ${t}`);
    }
    console.log();
    process.exit(1);
  }

  const currentModel = configManager.get<string>('providers.starterBrain.model') ?? DEFAULT_MODEL;

  if (currentModel === tag) {
    console.log();
    console.log(`  ${theme.dim('Already using')} ${theme.brand(tag)}`);
    console.log();
    return;
  }

  configManager.set('providers.starterBrain.model', tag);

  console.log();
  console.log(`  ${theme.success('✔')} Built-in model switched to ${theme.brand(tag)}`);
  console.log();
  console.log(`  ${theme.dim('Restart Tiny Claw for changes to take effect.')}`);
  console.log();
}

/**
 * `tinyclaw config model primary` - Show current primary provider
 * `tinyclaw config model primary clear` - Remove primary provider override
 */
async function handlePrimary(configManager: ConfigManager, action?: string): Promise<void> {
  if (action === 'clear') {
    const primaryModel = configManager.get<string>('providers.primary.model');

    if (!primaryModel) {
      console.log();
      console.log(`  ${theme.dim('No primary provider is configured. Nothing to clear.')}`);
      console.log();
      return;
    }

    configManager.delete('providers.primary');

    console.log();
    console.log(`  ${theme.success('✔')} Primary provider cleared`);
    console.log(`  ${theme.dim('Built-in will be used as the default provider.')}`);
    console.log();
    console.log(`  ${theme.dim('Restart Tiny Claw for changes to take effect.')}`);
    console.log();
    return;
  }

  // Show current primary
  const primaryModel = configManager.get<string>('providers.primary.model');
  const primaryBaseUrl = configManager.get<string>('providers.primary.baseUrl');
  const primaryApiKeyRef = configManager.get<string>('providers.primary.apiKeyRef');

  console.log();
  if (primaryModel) {
    console.log('  ' + theme.label('Primary Provider'));
    console.log();
    console.log(`    Model      : ${theme.brand(primaryModel)}`);
    if (primaryBaseUrl) {
      console.log(`    Base URL   : ${theme.dim(primaryBaseUrl)}`);
    }
    if (primaryApiKeyRef) {
      console.log(`    API Key    : ${theme.dim(`stored as "${primaryApiKeyRef}"`)}`);
    }
    console.log();
    console.log(`  ${theme.dim('Clear with:')} ${theme.cmd('tinyclaw config model primary clear')}`);
  } else {
    console.log(`  ${theme.label('Primary Provider')} ${theme.dim('(not configured)')}`);
    console.log();
    console.log(`  No primary provider is set. The built-in Ollama Cloud provider`);
    console.log(`  is used as the default for the smart router.`);
    console.log();
    console.log(`  To add a primary provider, install a provider plugin and`);
    console.log(`  ask Tiny Claw to set it as primary. You can also tell Tiny Claw:`);
    console.log(`  "list my providers" or "set OpenAI as my primary provider"`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Logging subcommands
// ---------------------------------------------------------------------------

/**
 * `tinyclaw config logging` - Show current log level
 */
async function showLogLevel(configManager: ConfigManager): Promise<void> {
  const current = configManager.get<string>('logging.level') ?? 'info';

  console.log();
  console.log('  ' + theme.label('Log Level'));
  console.log();

  for (const level of LOG_LEVELS) {
    const isCurrent = level === current;
    const marker = isCurrent ? theme.success('●') : theme.dim('○');
    const name = isCurrent ? theme.brand(level) : level;
    console.log(`  ${marker} ${name}`);
  }

  console.log();
  console.log(`  ${theme.dim('Change with:')} ${theme.cmd('tinyclaw config logging <level>')}`);
  console.log(`  ${theme.dim('Override per session with:')} ${theme.cmd('tinyclaw start --verbose')}`);
  console.log();
}

/**
 * `tinyclaw config logging <level>` - Set the persistent log level
 */
async function setLogLevel(configManager: ConfigManager, level: string): Promise<void> {
  if (!LOG_LEVELS.includes(level as LogLevel)) {
    console.log();
    console.log(theme.error(`  ✖ Unknown log level: ${level}`));
    console.log();
    console.log(`  Available levels:`);
    for (const l of LOG_LEVELS) {
      console.log(`    ${theme.dim('•')} ${l}`);
    }
    console.log();
    process.exit(1);
  }

  const current = configManager.get<string>('logging.level') ?? 'info';

  if (current === level) {
    console.log();
    console.log(`  ${theme.dim('Already set to')} ${theme.brand(level)}`);
    console.log();
    return;
  }

  configManager.set('logging.level', level);

  console.log();
  console.log(`  ${theme.success('✔')} Log level set to ${theme.brand(level)}`);
  console.log();
  console.log(`  ${theme.dim('Restart Tiny Claw for changes to take effect.')}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Route `tinyclaw config` subcommands.
 */
export async function configCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === '--help' || sub === '-h') {
    printUsage();
    return;
  }

  if (sub !== 'model' && sub !== 'logging') {
    console.log(theme.error(`  Unknown config subcommand: ${sub}`));
    printUsage();
    process.exit(1);
  }

  // Open config engine — respect TINYCLAW_DATA_DIR for consistent data dir usage
  const dataDir = process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
  const configManager = await ConfigManager.create({ cwd: join(dataDir, 'data') });

  try {
    // ---- logging ----
    if (sub === 'logging') {
      const level = args[1];
      if (!level) {
        await showLogLevel(configManager);
      } else {
        await setLogLevel(configManager, level);
      }
      return;
    }

    // ---- model ----
    const modelSub = args[1];

    switch (modelSub) {
      case undefined:
        await showModelConfig(configManager);
        break;

      case 'list':
        await listModels(configManager);
        break;

      case 'builtin': {
        const tag = args[2];
        if (!tag) {
          console.log(theme.error('  ✖ Missing model tag'));
          console.log();
          console.log(`  Usage: ${theme.cmd('tinyclaw config model builtin <tag>')}`);
          console.log();
          console.log(`  Available models:`);
          for (const t of BUILTIN_MODEL_TAGS) {
            console.log(`    ${theme.dim('•')} ${t}`);
          }
          console.log();
          process.exit(1);
        }
        await switchBuiltinModel(configManager, tag);
        break;
      }

      case 'primary': {
        const action = args[2];
        await handlePrimary(configManager, action);
        break;
      }

      default:
        console.log(theme.error(`  Unknown model subcommand: ${modelSub}`));
        printUsage();
        process.exit(1);
    }
  } finally {
    configManager.close();
  }
}
