/**
 * Web Setup Command
 *
 * Launches a setup-only web server at /setup for browser-based onboarding.
 * Once the owner completes setup, the web server stops and the agent
 * starts automatically via the supervisor restart mechanism.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigManager } from '@tinyclaw/config';
import { logger, setLogMode } from '@tinyclaw/logger';
import { SecretsManager } from '@tinyclaw/secrets';
import type { StreamCallback } from '@tinyclaw/types';
import { createWebUI } from '@tinyclaw/web';
import { RESTART_EXIT_CODE } from '../supervisor.js';
import { theme } from '../ui/theme.js';

/**
 * Run the web-based setup flow.
 *
 * Starts a minimal web server that serves only the /setup page.
 * When the owner completes setup, the process exits with RESTART_EXIT_CODE
 * so the supervisor respawns it as a normal `start` — this time with all
 * config in place, so the agent boots fully.
 */
export async function webSetupCommand(): Promise<void> {
  setLogMode('info');

  logger.log('Tiny Claw — Small agent, mighty friend', undefined, { emoji: '🐜' });

  const dataDir = process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
  logger.info('Data directory:', { dataDir }, { emoji: '📂' });

  // --- Initialize engines -----------------------------------------------

  const secretsManager = await SecretsManager.create();
  logger.info(
    'Secrets engine initialized',
    {
      storagePath: secretsManager.storagePath,
    },
    { emoji: '✅' },
  );

  const configManager = await ConfigManager.create();
  logger.info('Config engine initialized', { configPath: configManager.path }, { emoji: '✅' });

  // --- Launch setup-only web server -------------------------------------

  const parsedPort = parseInt(process.env.PORT || '3000', 10);
  const port =
    Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 3000;
  if (process.env.PORT && port !== parsedPort) {
    logger.warn(`Invalid PORT "${process.env.PORT}" — falling back to ${port}`, undefined, {
      emoji: '⚠️',
    });
  }
  const setupOnlyMessage =
    'Tiny Claw setup is not complete yet. Open /setup to finish onboarding, or run tinyclaw setup in the CLI.';

  logger.info('─'.repeat(52), undefined, { emoji: '' });
  logger.info('Web setup mode enabled (--web)', undefined, { emoji: '⚠️' });
  logger.info('─'.repeat(52), undefined, { emoji: '' });

  // --- Auto-build Web UI if needed --------------------------------------

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
      // Fallback 2: resolve relative to this file
      webRoot = resolve(import.meta.dir, '..', '..', '..', 'web');
    }
  }
  const webDistIndex = join(webRoot, 'dist', 'index.html');

  let needsBuild = !existsSync(webDistIndex);
  if (!needsBuild) {
    try {
      const distMtime = statSync(webDistIndex).mtimeMs;
      const srcDir = join(webRoot, 'src');
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
          logger.warn('Web UI build failed — setup page may not display correctly', undefined, {
            emoji: '⚠️',
          });
          if (stderr) logger.warn(stderr);
        }
      } catch (err) {
        logger.warn('Could not build Web UI:', err, { emoji: '⚠️' });
      }
    }
  }

  // --- Launch setup-only web server -------------------------------------

  const setupWebUI = createWebUI({
    port,
    webRoot,
    configManager,
    secretsManager,
    configDbPath: configManager.path,
    dataDir,
    onOwnerClaimed: async (ownerId: string) => {
      logger.info('Owner claimed via web setup flow', { ownerId }, { emoji: '🔑' });
      logger.info('Setup complete — starting Tiny Claw agent...', undefined, { emoji: '🚀' });

      // Graceful shutdown: stop web server, then close managers before restart
      try {
        await setupWebUI.stop();
      } catch (err) {
        logger.warn('Error stopping web server during shutdown', { err }, { emoji: '⚠️' });
      }
      try {
        configManager.close();
      } catch (err) {
        logger.warn('Error closing config manager during shutdown', { err }, { emoji: '⚠️' });
      } // sync — ConfigManager.close() returns void
      try {
        await secretsManager.close();
      } catch (err) {
        logger.warn('Error closing secrets manager during shutdown', { err }, { emoji: '⚠️' });
      }

      // Exit with restart code so the supervisor respawns as a normal start
      process.exit(RESTART_EXIT_CODE);
    },
    onMessage: async () => setupOnlyMessage,
    onMessageStream: async (_message: string, _userId: string, callback: StreamCallback) => {
      callback({ type: 'text', content: setupOnlyMessage });
      callback({ type: 'done' });
    },
    getBackgroundTasks: () => [],
    getSubAgents: () => [],
  });

  await setupWebUI.start();

  logger.info('Setup-only web server is running', 'web', { emoji: '🛠️' });
  logger.info(`Open: ${theme.brand(`http://localhost:${port}/setup`)}`, 'web', { emoji: '🔗' });
}
