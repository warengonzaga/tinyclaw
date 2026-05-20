/**
 * Plugin Command
 *
 * CLI interface for managing Tiny Claw community plugins.
 *
 * Usage:
 *   tinyclaw plugin add <package>           Install a community plugin from npm
 *   tinyclaw plugin add --dry-run <package>  Validate without installing
 *   tinyclaw plugin remove <package>         Remove a community plugin
 *   tinyclaw plugin update [package]         Update one or all community plugins
 *   tinyclaw plugin list                     List all plugins (official + community)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@tinyclaw/config';
import {
  getCommunityPlugins,
  installCommunityPlugin,
  listCommunityPlugins,
  removeCommunityPlugin,
  validatePackageName,
} from '@tinyclaw/plugins';
import { theme } from '../ui/theme.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log();
  console.log(`  ${theme.label('Usage')}`);
  console.log(
    `    ${theme.cmd('tinyclaw plugin add')} <package>           Install a community plugin from npm`,
  );
  console.log(
    `    ${theme.cmd('tinyclaw plugin add --dry-run')} <package>  Validate without installing`,
  );
  console.log(
    `    ${theme.cmd('tinyclaw plugin remove')} <package>         Remove a community plugin`,
  );
  console.log(
    `    ${theme.cmd('tinyclaw plugin update')} [package]         Update one or all community plugins`,
  );
  console.log(
    `    ${theme.cmd('tinyclaw plugin list')}                     List all plugins (official + community)`,
  );
  console.log();
  console.log(`  ${theme.label('Examples')}`);
  console.log(`    ${theme.dim('tinyclaw plugin add @acme/tinyclaw-plugin-telegram')}`);
  console.log(`    ${theme.dim('tinyclaw plugin add --dry-run tinyclaw-plugin-notion')}`);
  console.log(`    ${theme.dim('tinyclaw plugin remove @acme/tinyclaw-plugin-telegram')}`);
  console.log(`    ${theme.dim('tinyclaw plugin update')}`);
  console.log(`    ${theme.dim('tinyclaw plugin update tinyclaw-plugin-notion')}`);
  console.log(`    ${theme.dim('tinyclaw plugin list')}`);
  console.log();
  console.log(`  ${theme.label('Notes')}`);
  console.log(
    `    Community plugins are third-party packages and are ${theme.warn('unverified')}.`,
  );
  console.log(`    Official plugins (@tinyclaw/plugin-*) are managed via the monorepo.`);
  console.log();
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function addPlugin(
  packageName: string,
  configManager: ConfigManager,
  dryRun: boolean,
): Promise<void> {
  console.log();

  if (dryRun) {
    console.log(`  ${theme.brand('Dry-run validation...')} ${theme.dim(packageName)}`);
    console.log();

    const validation = validatePackageName(packageName);
    if (!validation) {
      console.log(`  ${theme.error('✖')} Invalid or disallowed package name: ${packageName}`);
      console.log();
      return;
    }

    // Fetch the package from npm registry to confirm it exists
    const safeName = encodeURIComponent(validation.name);
    try {
      const res = await fetch(`https://registry.npmjs.org/${safeName}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.log(`  ${theme.error('\u2716')} Package not found on npm: ${validation.name}`);
        console.log();
        return;
      }
      const data = (await res.json()) as {
        'dist-tags'?: { latest?: string };
        description?: string;
      };
      const latest = data['dist-tags']?.latest ?? 'unknown';
      console.log(`  ${theme.success('✔')} Package is valid and exists on npm`);
      console.log();
      console.log(`    Name        : ${theme.dim(validation.name)}`);
      console.log(`    Latest      : ${theme.dim(latest)}`);
      if (data.description) {
        console.log(`    Description : ${theme.dim(data.description)}`);
      }
      console.log();
      console.log(`  Run without ${theme.cmd('--dry-run')} to install.`);
    } catch {
      console.log(`  ${theme.warn('⚠')} Package name is valid but npm registry check failed.`);
    }
    console.log();
    return;
  }

  console.log(`  ${theme.brand('Installing plugin...')} ${theme.dim(packageName)}`);
  console.log();

  const result = await installCommunityPlugin(packageName, configManager);

  if (result.success && result.plugin) {
    console.log(`  ${theme.success('✔')} ${result.plugin.name} installed successfully`);
    console.log();
    console.log(`    ID      : ${theme.dim(result.plugin.id)}`);
    console.log(`    Type    : ${theme.dim(result.plugin.type)}`);
    console.log(`    Version : ${theme.dim(result.plugin.version)}`);
    console.log(`    Source  : ${theme.warn('community (unverified)')}`);
    console.log();
    console.log(`  Run ${theme.cmd('tinyclaw start')} to activate the plugin.`);
  } else {
    console.log(`  ${theme.error('✖')} ${result.message}`);
  }
  console.log();
}

async function removePlugin(packageName: string, configManager: ConfigManager): Promise<void> {
  console.log();
  console.log(`  ${theme.brand('Removing plugin...')} ${theme.dim(packageName)}`);
  console.log();

  const result = await removeCommunityPlugin(packageName, configManager);

  if (result.success) {
    console.log(`  ${theme.success('✔')} ${result.message}`);
  } else {
    console.log(`  ${theme.error('✖')} ${result.message}`);
  }
  console.log();
}

async function updatePlugins(
  packageName: string | undefined,
  configManager: ConfigManager,
): Promise<void> {
  const community = getCommunityPlugins(configManager);

  if (community.length === 0) {
    console.log();
    console.log(`  ${theme.dim('No community plugins installed. Nothing to update.')}`);
    console.log();
    return;
  }

  const targets = packageName ? [packageName] : community;

  if (packageName && !community.includes(packageName)) {
    console.log();
    console.log(
      `  ${theme.error('✖')} Plugin "${packageName}" is not a registered community plugin.`,
    );
    console.log();
    return;
  }

  console.log();
  console.log(`  ${theme.brand('Updating community plugins...')}`);
  console.log();

  for (const id of targets) {
    console.log(`  ${theme.dim('↻')} ${id}`);
    const proc = Bun.spawnSync(['bun', 'update', id], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
    });
    if (proc.exitCode === 0) {
      console.log(`    ${theme.success('✔')} updated`);
    } else {
      const stderr = proc.stderr.toString().trim();
      console.log(`    ${theme.error('✖')} failed${stderr ? `: ${stderr}` : ''}`);
    }
  }

  console.log();
  console.log(`  Run ${theme.cmd('tinyclaw start')} to pick up new versions.`);
  console.log();
}

async function listPlugins(configManager: ConfigManager): Promise<void> {
  const enabledIds = configManager.get<string[]>('plugins.enabled') ?? [];

  console.log();
  console.log(`  ${theme.label('Installed Plugins')}`);
  console.log();

  // Official plugins
  const officialEnabled = enabledIds.filter((id) => id.startsWith('@tinyclaw/plugin-'));
  console.log(`  ${theme.label('Official')} ${theme.dim('(verified @tinyclaw/plugin-*)')}`);

  if (officialEnabled.length === 0) {
    console.log(`    ${theme.dim('No official plugins enabled')}`);
  } else {
    for (const id of officialEnabled) {
      try {
        const mod = await import(id);
        const p = mod.default;
        console.log(
          `    ${theme.success('●')} ${p?.name ?? id} ${theme.dim(`v${p?.version ?? '?'}`)} ${theme.dim(`(${p?.type ?? '?'})`)}`,
        );
      } catch {
        console.log(`    ${theme.warn('●')} ${id} ${theme.dim('(failed to load)')}`);
      }
    }
  }

  console.log();

  // Community plugins
  const communityPlugins = await listCommunityPlugins(configManager);
  console.log(`  ${theme.label('Community')} ${theme.warn('(unverified)')}`);

  if (communityPlugins.length === 0) {
    console.log(`    ${theme.dim('No community plugins installed')}`);
    console.log();
    console.log(`    Install one with: ${theme.cmd('tinyclaw plugin add <package-name>')}`);
  } else {
    for (const cp of communityPlugins) {
      const status = cp.enabled ? theme.success('enabled') : theme.dim('installed');
      console.log(
        `    ${cp.enabled ? theme.success('●') : theme.dim('○')} ${cp.name} ${theme.dim(`v${cp.version}`)} ${theme.dim(`(${cp.type})`)} [${status}]`,
      );
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function pluginCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  const dataDir = process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
  const configManager = await ConfigManager.create(dataDir);

  try {
    switch (subcommand) {
      case 'add': {
        const dryRun = args.includes('--dry-run');
        const remaining = args.slice(1).filter((a) => a !== '--dry-run');
        const packageName = remaining[0];
        if (!packageName) {
          console.log(theme.error('  ✖ Missing package name.'));
          printUsage();
          process.exit(1);
        }
        await addPlugin(packageName, configManager, dryRun);
        break;
      }

      case 'remove': {
        const packageName = args[1];
        if (!packageName) {
          console.log(theme.error('  ✖ Missing package name.'));
          printUsage();
          process.exit(1);
        }
        await removePlugin(packageName, configManager);
        break;
      }

      case 'list': {
        await listPlugins(configManager);
        break;
      }

      case 'update': {
        const target = args[1]; // optional — update all if omitted
        await updatePlugins(target, configManager);
        break;
      }

      default: {
        if (subcommand) {
          console.log(theme.error(`  ✖ Unknown subcommand: ${subcommand}`));
        }
        printUsage();
        break;
      }
    }
  } finally {
    configManager.close();
  }
}
