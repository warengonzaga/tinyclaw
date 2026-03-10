import { existsSync, readFileSync } from 'node:fs';

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
  } catch {
    /* ignore */
  }
  try {
    const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd|kubepods|lxc|podman/i.test(cgroup)) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
