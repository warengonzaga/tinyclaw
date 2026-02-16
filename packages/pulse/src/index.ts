/**
 * Pulse Scheduler — Tiny Claw's cron-like recurring task system.
 *
 * "Pulse" is Tiny Claw's version of OpenClaw's "Heartbeat" scheduler.
 * Lightweight interval-based scheduler that supports simple
 * interval strings ('30m', '1h', '24h') and runs handlers
 * through the session queue to prevent conflicts.
 */

import type { PulseJob } from '@tinyclaw/types';
import { logger } from '@tinyclaw/logger';

export interface PulseScheduler {
  register(job: PulseJob): void;
  start(): void;
  stop(): void;
  jobs(): PulseJob[];
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

export function createPulseScheduler(): PulseScheduler {
  const registered: PulseJob[] = [];
  const timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  let running = false;

  return {
    register(job: PulseJob): void {
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

      logger.info('Pulse scheduler started', {
        jobs: registered.map((j) => `${j.id} (${j.schedule})`),
      });
    },

    stop(): void {
      running = false;
      for (const [id, timer] of timers) {
        clearInterval(timer);
        timers.delete(id);
      }
      logger.info('Pulse scheduler stopped');
    },

    jobs(): PulseJob[] {
      return [...registered];
    },
  };

  function startJob(job: PulseJob): void {
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
