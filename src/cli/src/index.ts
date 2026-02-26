#!/usr/bin/env bun

/**
 * Tiny Claw CLI — Entry Point
 *
 * Lightweight argument router. No framework — just process.argv.
 *
 * Usage:
 *   tinyclaw                 Show banner + help
 *   tinyclaw setup           Interactive first-time setup wizard
 *   tinyclaw setup --web     Start web onboarding at /setup
 *   tinyclaw setup --docker  Force web mode for Docker/container environments
 *   tinyclaw start           Boot the agent (requires setup first)
 *   tinyclaw purge           Wipe all data for a fresh install
 *   tinyclaw --version       Print version
 *   tinyclaw --help          Show help
 */

import { logger } from '@tinyclaw/logger';
import { getVersion, showBanner } from './ui/banner.js';
import { theme } from './ui/theme.js';
import { existsSync, readFileSync } from 'fs';

// ── Docker Detection ───────────────────────────────────────────────────

/**
 * Detect if running inside a Docker container or CI environment.
 * Checks for common indicators: .dockerenv, cgroup, CI env vars, container-specific env vars.
 */
function detectDockerEnvironment(): boolean {
  // Check for explicit CI/container environment variables
  if (process.env.CI || process.env.CONTAINER || process.env.DOCKER_CONTAINER) {
    return true;
  }

  // Check for .dockerenv file (older Docker versions)
  try {
    if (existsSync('/.dockerenv')) {
      return true;
    }
  } catch {
    // Ignore errors
  }

  // Check cgroup for container indicators
  try {
    const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd|kubepods|lxc|podman/i.test(cgroup)) {
      return true;
    }
  } catch {
    // Ignore errors (file may not exist or be readable)
  }

  return false;
}

// ── Help text ──────────────────────────────────────────────────────────

function showHelp(): void {
  showBanner();
  console.log(`  ${theme.label('Usage')}`);
  console.log(`    ${theme.cmd('tinyclaw')} ${theme.dim('<command>')}`);
  console.log();
  console.log(`  ${theme.label('Commands')}`);
  console.log(`    ${theme.cmd('setup')}    Interactive setup wizard`);
  console.log(`             ${theme.dim('Use --web for browser onboarding')}`);
  console.log(`             ${theme.dim('Use --docker for Docker/container environments (auto-detected)')}`);
  console.log(`    ${theme.cmd('start')}    Start the Tiny Claw agent`);
  console.log(`    ${theme.cmd('config')}   Manage models, providers, and settings`);
  console.log(`    ${theme.cmd('seed')}     Show your Tiny Claw's soul seed`);
  console.log(`    ${theme.cmd('backup')}   Export or import a .tinyclaw backup archive`);
  console.log(
    `    ${theme.cmd('purge')}    Wipe all data for a fresh install (--force to include secrets)`,
  );
  console.log();
  console.log(`  ${theme.label('Options')}`);
  console.log(`    ${theme.dim('--docker')}        Force web-based setup for Docker/container environments`);
  console.log(`    ${theme.dim('--web')}           Use web-based setup instead of CLI wizard`);
  console.log(`    ${theme.dim('--verbose')}       Show debug-level logs during start`);
  console.log(`    ${theme.dim('--version, -v')}   Show version number`);
  console.log(`    ${theme.dim('--help, -h')}      Show this help message`);
  console.log();
}

// ── Main router ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'setup': {
      // Detect Docker/container environment and auto-route to web mode
      const isDocker = args.includes('--docker') || detectDockerEnvironment();
      const isWeb = args.includes('--web') || isDocker;

      if (isWeb) {
        // Web setup goes through supervisor so the restart mechanism works
        const { supervisedStart } = await import('./supervisor.js');
        await supervisedStart();
        break;
      }

      const { setupCommand } = await import('./commands/setup.js');
      await setupCommand();
      break;
    }

    case 'start': {
      const { supervisedStart } = await import('./supervisor.js');
      await supervisedStart();
      break;
    }

    case '--supervised-start': {
      if (args.includes('--web')) {
        // Web setup mode — after setup completes, exits with restart code
        // so the supervisor respawns without --web as a normal start
        const { webSetupCommand } = await import('./commands/setup-web.js');
        await webSetupCommand();
      } else {
        const { startCommand } = await import('./commands/start.js');
        await startCommand();
      }
      break;
    }

    case 'config': {
      const { configCommand } = await import('./commands/config.js');
      await configCommand(args.slice(1));
      break;
    }

    case 'backup': {
      const { backupCommand } = await import('./commands/backup.js');
      await backupCommand(args.slice(1));
      break;
    }

    case 'purge': {
      const { purgeCommand } = await import('./commands/purge.js');
      await purgeCommand(args.slice(1));
      break;
    }

    case 'seed': {
      const { seedCommand } = await import('./commands/seed.js');
      await seedCommand();
      break;
    }

    case '--version':
    case '-v': {
      console.log(getVersion());
      break;
    }

    case '--help':
    case '-h':
    case undefined: {
      showHelp();
      break;
    }

    default: {
      console.log(theme.error(`  Unknown command: ${command}`));
      console.log();
      showHelp();
      process.exit(1);
    }
  }
}

main().catch((error) => {
  logger.error('Fatal error:', error, { emoji: '❌' });
  process.exit(1);
});
