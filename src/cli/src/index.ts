#!/usr/bin/env node

/**
 * Tiny Claw CLI — Entry Point
 *
 * Lightweight argument router. No framework — just process.argv.
 *
 * Usage:
 *   tinyclaw              Show banner + help
 *   tinyclaw setup        Interactive first-time setup wizard
 *   tinyclaw setup --web  Start web onboarding at /setup
 *   tinyclaw start        Boot the agent (requires setup first)
 *   tinyclaw purge        Wipe all data for a fresh install
 *   tinyclaw --version    Print version
 *   tinyclaw --help       Show help
 */

import { logger } from '@tinyclaw/logger';
import { showBanner, getVersion } from './ui/banner.js';
import { theme } from './ui/theme.js';

// ── Help text ──────────────────────────────────────────────────────────

function showHelp(): void {
  showBanner();
  console.log('  ' + theme.label('Usage'));
  console.log(`    ${theme.cmd('tinyclaw')} ${theme.dim('<command>')}`);
  console.log();
  console.log('  ' + theme.label('Commands'));
  console.log(`    ${theme.cmd('setup')}    Interactive setup wizard (use --web for browser onboarding)`);
  console.log(`    ${theme.cmd('start')}    Start the Tiny Claw agent`);
  console.log(`    ${theme.cmd('config')}   Manage models, providers, and settings`);
  console.log(`    ${theme.cmd('seed')}     Show your Tiny Claw's soul seed`);
  console.log(`    ${theme.cmd('backup')}   Export or import a .tinyclaw backup archive`);
  console.log(`    ${theme.cmd('purge')}    Wipe all data for a fresh install (--force to include secrets)`);
  console.log();
  console.log('  ' + theme.label('Options'));
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
      if (args.includes('--web')) {
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
      console.log(
        theme.error(`  Unknown command: ${command}`)
      );
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
