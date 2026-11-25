import { existsSync, readFileSync } from 'node:fs';
import { logger } from '@tinyclaw/logger';

/**
 * Detect if running inside a Docker container or CI environment.
 * Checks for common indicators: .dockerenv, cgroup, CI env vars, container-specific env vars.
 */
export function isRunningInContainer(): boolean {
  if (process.env.CI || process.env.CONTAINER || process.env.DOCKER_CONTAINER) {
    return true;
  }
  try {
    if (existsSync('/.dockerenv')) {
      return true;
    }
  } catch (err) {
    logger.debug('Container detection: failed to check /.dockerenv', err);
  }
  try {
    const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd|kubepods|lxc|podman/i.test(cgroup)) {
      return true;
    }
  } catch (err) {
    logger.debug('Container detection: failed to read /proc/1/cgroup', err);
  }
  return false;
}
