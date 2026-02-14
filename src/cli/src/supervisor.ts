/**
 * Process Supervisor
 *
 * Wraps the TinyClaw agent in a restart-aware loop. When the agent
 * process exits with exit code 75 (RESTART_EXIT_CODE), the supervisor
 * automatically respawns it. Any other exit code is treated as final.
 *
 * This enables the agent to restart itself after configuration changes
 * (e.g., pairing a new provider or channel plugin) without requiring
 * manual user intervention.
 *
 * Flow:
 *   supervisor → spawn child (startCommand)
 *       child exits 75  → supervisor logs + respawns
 *       child exits 0   → supervisor exits 0 (clean shutdown)
 *       child exits N   → supervisor exits N (error passthrough)
 */

import { spawn } from 'child_process';
import { logger } from '@tinyclaw/logger';

/**
 * Exit code that signals the supervisor to restart the agent.
 * 75 was chosen because it is unused by conventional standards and
 * aligns with EX_TEMPFAIL from sysexits.h (temporary failure, retry).
 */
export const RESTART_EXIT_CODE = 75;

/**
 * Maximum number of rapid restarts before the supervisor gives up.
 * Prevents infinite crash loops.
 */
const MAX_RAPID_RESTARTS = 5;

/**
 * Time window (ms) for counting rapid restarts. If the agent crashes
 * MAX_RAPID_RESTARTS times within this window, the supervisor exits.
 */
const RAPID_RESTART_WINDOW_MS = 60_000; // 1 minute

/**
 * Launch the agent under a supervisor that handles restart exit codes.
 *
 * Instead of running startCommand() in-process, the supervisor spawns
 * the current script with a special `--supervised-start` flag as a child
 * process. This gives full process isolation so a restart is truly clean.
 */
export async function supervisedStart(): Promise<void> {
  const restartTimestamps: number[] = [];

  const spawnAgent = (): void => {
    // Track restart frequency
    const now = Date.now();
    restartTimestamps.push(now);

    // Prune timestamps outside the window
    while (
      restartTimestamps.length > 0 &&
      restartTimestamps[0]! < now - RAPID_RESTART_WINDOW_MS
    ) {
      restartTimestamps.shift();
    }

    if (restartTimestamps.length > MAX_RAPID_RESTARTS) {
      logger.error(
        `Agent restarted ${MAX_RAPID_RESTARTS} times within ${RAPID_RESTART_WINDOW_MS / 1000}s — aborting to prevent crash loop.`
      );
      process.exit(1);
    }

    const execPath = process.argv[0]!;
    const scriptPath = process.argv[1]!;

    const child = spawn(execPath, [scriptPath, '--supervised-start'], {
      stdio: 'inherit',
      env: { ...process.env, TINYCLAW_SUPERVISED: '1' },
    });

    child.on('exit', (code) => {
      if (code === RESTART_EXIT_CODE) {
        logger.log('');
        logger.log('Restart requested — respawning agent...', undefined, { emoji: '🔄' });
        logger.log('');
        spawnAgent();
        return;
      }

      // Pass through the exit code
      process.exit(code ?? 0);
    });

    child.on('error', (err) => {
      logger.error('Supervisor: failed to spawn agent process:', err);
      process.exit(1);
    });

    // Forward SIGINT to the child so it can do graceful shutdown
    process.on('SIGINT', () => {
      child.kill('SIGINT');
    });
  };

  spawnAgent();
}
