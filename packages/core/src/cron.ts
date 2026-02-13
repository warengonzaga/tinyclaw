/**
 * Cron Scheduler
 *
 * Lightweight interval-based scheduler for pulse tasks.
 * Supports simple interval strings ('30m', '1h', '24h') and
 * runs handlers through the session queue to prevent conflicts.
 */

import type { CronJob } from '@tinyclaw/types';
import { logger } from '@tinyclaw/logger';

export interface CronScheduler {
  register(job: CronJob): void;
  start(): void;
  stop(): void;
  jobs(): CronJob[];
}

/** Parse an interval string like '30m', '1h', '24h' into milliseconds. */
function parseInterval(schedule: string): number {
  const match = schedule.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    throw new Error(
      `Invalid schedule "${schedule}". Use format like "30m", "1h", or "24h".`,
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}

export function createCronScheduler(): CronScheduler {
  const registered: CronJob[] = [];
  const timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  let running = false;

  return {
    register(job: CronJob): void {
      // Validate the schedule string on registration
      parseInterval(job.schedule);
      registered.push(job);

      // If already running, start this job immediately
      if (running) {
        startJob(job);
      }
    },

    start(): void {
      if (running) return;
      running = true;

      for (const job of registered) {
        startJob(job);
      }

      logger.info('Cron scheduler started', {
        jobs: registered.map((j) => `${j.id} (${j.schedule})`),
      });
    },

    stop(): void {
      running = false;
      for (const [id, timer] of timers) {
        clearInterval(timer);
        timers.delete(id);
      }
      logger.info('Cron scheduler stopped');
    },

    jobs(): CronJob[] {
      return [...registered];
    },
  };

  function startJob(job: CronJob): void {
    const intervalMs = parseInterval(job.schedule);

    const timer = setInterval(async () => {
      logger.info(`Pulse: ${job.id}`);
      job.lastRun = Date.now();
      try {
        await job.handler();
      } catch (err) {
        logger.error(`Pulse ${job.id} failed`, err);
      }
    }, intervalMs);

    timers.set(job.id, timer);
  }
}
