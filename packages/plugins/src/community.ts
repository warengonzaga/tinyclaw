/**
 * Community Plugin Manager
 *
 * Provides helpers for installing, removing, and listing third-party
 * (community) plugins that live outside the official monorepo.
 *
 * Community plugins are stored in the config key `plugins.community: string[]`
 * — separate from `plugins.enabled` which tracks actively running plugins.
 *
 * Installation flow:
 *   1. Validate the package name (strict npm naming rules)
 *   2. Run `bun add <package>` to install the dependency
 *   3. Dynamically import the package and validate the plugin contract
 *   4. Register it in `plugins.community`
 *
 * Security:
 *   - Package names are validated against strict npm naming rules before any
 *     shell execution — no metacharacters, no path traversal.
 *   - Official `@tinyclaw/plugin-*` packages are rejected from this flow
 *     (they are managed via the monorepo, not community install).
 *   - The installed module must satisfy the TinyClawPlugin interface before
 *     it's registered — random npm packages that aren't plugins are rejected.
 */

import { logger } from '@tinyclaw/logger';
import type { ConfigManagerInterface, TinyClawPlugin } from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Strict npm package name pattern (lowercase only, no shell metacharacters).
 *
 * Allows:
 *   - Scoped packages: `@scope/name` (lowercase alphanumeric, hyphens, dots)
 *   - Unscoped packages: `name`
 *   - Optional version suffix: `@1.2.3`, `@^1.0.0`, `@latest`
 *
 * Rejects everything else — no uppercase, no underscores in names, no spaces,
 * no shell metacharacters, no path separators.
 */
const VALID_PACKAGE_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(@[a-z0-9.^~>=<|-]+)?$/;

/**
 * Validate a package name is safe for shell execution and npm resolution.
 * Returns the cleaned name (without version suffix) or null if invalid.
 */
export function validatePackageName(input: string): { name: string; installSpec: string } | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 214) return null;
  if (!VALID_PACKAGE_RE.test(trimmed)) return null;

  // Split name from version suffix for the name-only checks.
  // Safe: the regex above guarantees scoped packages contain '/' and
  // that the only '@' positions are scope-prefix and version-suffix.
  const atIdx = trimmed.lastIndexOf('@');
  const hasVersionSuffix = atIdx > 0 && !trimmed.startsWith('@', atIdx - 1);
  const name = hasVersionSuffix ? trimmed.slice(0, atIdx) : trimmed;

  // Reject official plugins — they're managed via the monorepo
  if (name.startsWith('@tinyclaw/plugin-')) return null;

  return { name, installSpec: trimmed };
}

// ---------------------------------------------------------------------------
// Plugin contract validation
// ---------------------------------------------------------------------------

/**
 * Dynamically import a package and verify it exports a valid TinyClawPlugin.
 * Returns the plugin on success, null on failure.
 */
async function validatePluginModule(packageName: string): Promise<TinyClawPlugin | null> {
  try {
    const mod = await import(packageName);
    const plugin = mod.default as TinyClawPlugin | undefined;

    if (!plugin || typeof plugin !== 'object') return null;

    const hasRequiredFields =
      'id' in plugin &&
      'name' in plugin &&
      'type' in plugin &&
      'version' in plugin &&
      typeof plugin.id === 'string' &&
      typeof plugin.name === 'string' &&
      typeof plugin.type === 'string' &&
      typeof plugin.version === 'string' &&
      ['channel', 'provider', 'tools'].includes(plugin.type);

    if (!hasRequiredFields) return null;

    return plugin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/** Read the community plugin list from config. */
export function getCommunityPlugins(configManager: ConfigManagerInterface): string[] {
  return configManager.get<string[]>('plugins.community') ?? [];
}

/** Add a plugin to the community list (idempotent). */
function addToCommunityList(configManager: ConfigManagerInterface, packageName: string): void {
  const current = getCommunityPlugins(configManager);
  if (!current.includes(packageName)) {
    configManager.set('plugins.community', [...current, packageName]);
  }
}

/** Remove a plugin from the community list. */
function removeFromCommunityList(configManager: ConfigManagerInterface, packageName: string): void {
  const current = getCommunityPlugins(configManager);
  configManager.set(
    'plugins.community',
    current.filter((id) => id !== packageName),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InstallResult {
  success: boolean;
  message: string;
  plugin?: { id: string; name: string; type: string; version: string };
}

/**
 * Install a community plugin from npm.
 *
 * 1. Validates the package name
 * 2. Runs `bun add <package>` to install
 * 3. Imports the module and validates the plugin contract
 * 4. Registers in `plugins.community` config
 *
 * @returns Result with success status and a human-readable message
 */
export async function installCommunityPlugin(
  packageInput: string,
  configManager: ConfigManagerInterface,
): Promise<InstallResult> {
  // 1. Validate package name
  const validated = validatePackageName(packageInput);
  if (!validated) {
    return {
      success: false,
      message: `Invalid package name "${packageInput}". Must be a valid npm package name. Official @tinyclaw/plugin-* packages are managed separately.`,
    };
  }

  const { name, installSpec } = validated;

  // 2. Check if already registered
  const community = getCommunityPlugins(configManager);
  if (community.includes(name)) {
    return {
      success: false,
      message: `Plugin "${name}" is already registered as a community plugin.`,
    };
  }

  // 3. Install via bun
  logger.info(`Installing community plugin: ${installSpec}`, undefined, { emoji: '📦' });

  try {
    const proc = Bun.spawnSync(['bun', 'add', installSpec], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
    });

    if (proc.exitCode !== 0) {
      const stderr = proc.stderr.toString().trim();
      return {
        success: false,
        message: `Failed to install "${installSpec}" from npm. ${stderr ? `Error: ${stderr.slice(0, 200)}` : 'The package may not exist or the registry is unreachable.'}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `Installation failed: ${(err as Error).message}`,
    };
  }

  // 4. Validate the plugin contract
  const plugin = await validatePluginModule(name);
  if (!plugin) {
    // Installed but not a valid plugin — remove it
    try {
      Bun.spawnSync(['bun', 'remove', name], {
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 30_000,
      });
    } catch {
      // Best-effort cleanup
    }

    return {
      success: false,
      message: `Package "${name}" was installed but does not export a valid Tiny Claw plugin (must default-export an object with id, name, type, version). Package was removed.`,
    };
  }

  // 5. Register in config
  addToCommunityList(configManager, name);

  logger.info(`Community plugin installed: ${plugin.name} (${plugin.id})`, undefined, {
    emoji: '✅',
  });

  return {
    success: true,
    message: `Community plugin "${plugin.name}" (${plugin.id} v${plugin.version}) installed successfully. Restart Tiny Claw to activate it.`,
    plugin: {
      id: plugin.id,
      name: plugin.name,
      type: plugin.type,
      version: plugin.version,
    },
  };
}

/**
 * Remove a community plugin.
 *
 * Removes from `plugins.community` and `plugins.enabled`, then runs `bun remove`.
 */
export async function removeCommunityPlugin(
  packageName: string,
  configManager: ConfigManagerInterface,
): Promise<InstallResult> {
  const validated = validatePackageName(packageName);
  if (!validated) {
    return { success: false, message: `Invalid package name "${packageName}".` };
  }

  const { name } = validated;
  const community = getCommunityPlugins(configManager);

  if (!community.includes(name)) {
    return {
      success: false,
      message: `Plugin "${name}" is not registered as a community plugin.`,
    };
  }

  // Remove from config lists
  removeFromCommunityList(configManager, name);

  // Also remove from enabled if present
  const enabled = configManager.get<string[]>('plugins.enabled') ?? [];
  const wasEnabled = enabled.includes(name);
  if (wasEnabled) {
    configManager.set(
      'plugins.enabled',
      enabled.filter((id) => id !== name),
    );
  }

  // Uninstall the npm package
  try {
    Bun.spawnSync(['bun', 'remove', name], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    });
  } catch {
    // Best-effort — config is already cleaned up
  }

  logger.info(`Community plugin removed: ${name}`, undefined, { emoji: '🗑️' });

  return {
    success: true,
    message: wasEnabled
      ? `Community plugin "${name}" removed and disabled. Restart Tiny Claw to stop the running instance.`
      : `Community plugin "${name}" removed.`,
  };
}

export interface CommunityPluginInfo {
  id: string;
  name: string;
  type: string;
  version: string;
  enabled: boolean;
  source: 'community';
}

/**
 * List all registered community plugins with their status.
 * Imports are parallelized to avoid serial delays with many plugins.
 */
export async function listCommunityPlugins(
  configManager: ConfigManagerInterface,
): Promise<CommunityPluginInfo[]> {
  const community = getCommunityPlugins(configManager);
  const enabled = new Set(configManager.get<string[]>('plugins.enabled') ?? []);

  const results = await Promise.all(
    community.map(async (id): Promise<CommunityPluginInfo> => {
      try {
        const mod = await import(id);
        const plugin = mod.default as TinyClawPlugin | undefined;

        if (plugin && typeof plugin === 'object') {
          return {
            id: plugin.id ?? id,
            name: plugin.name ?? id,
            type: plugin.type ?? 'unknown',
            version: plugin.version ?? 'unknown',
            enabled: enabled.has(id),
            source: 'community',
          };
        }
        return {
          id,
          name: id,
          type: 'unknown',
          version: 'unknown',
          enabled: enabled.has(id),
          source: 'community',
        };
      } catch {
        return {
          id,
          name: id,
          type: 'unknown',
          version: 'unresolvable',
          enabled: enabled.has(id),
          source: 'community',
        };
      }
    }),
  );

  return results;
}
