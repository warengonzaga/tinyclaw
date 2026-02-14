/**
 * Background Runner
 *
 * Non-blocking sub-agent execution. Tasks run asynchronously so the
 * primary agent can continue chatting. Results are delivered on the
 * next conversation turn via notification injection in agentLoop.
 */

import type { Provider, Tool, Message } from '@tinyclaw/types';
import { logger } from '@tinyclaw/logger';
import type { DelegationStore, DelegationQueue } from './store.js';
import type {
  BackgroundRunner,
  BackgroundTaskRecord,
  LifecycleManager,
  TemplateManager,
  OrientationContext,
} from './types.js';
import type { TimeoutEstimator } from './timeout-estimator.js';
import { runSubAgentV2 } from './runner.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fallback background task timeout (used when no estimator). */
const BACKGROUND_TIMEOUT_MS = 120_000;

/** Max concurrent background tasks per user. */
const MAX_CONCURRENT_PER_USER = 3;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createBackgroundRunner(
  db: DelegationStore,
  lifecycle: LifecycleManager,
  queue: DelegationQueue,
  timeoutEstimator?: TimeoutEstimator,
  templates?: TemplateManager,
): BackgroundRunner {
  /** In-flight AbortControllers keyed by taskId. */
  const controllers = new Map<string, AbortController>();

  return {
    start(config) {
      const {
        userId,
        agentId,
        task,
        provider,
        tools,
        orientation,
        existingMessages,
        templateId,
        templateAutoCreate,
      } = config;

      // Enforce concurrency limit
      const running = db.getUndeliveredTasks(userId).filter(
        (t) => t.status === 'running',
      );
      // Also check tasks that are in the undelivered list but not yet completed
      // getUndeliveredTasks returns completed+failed, so count running from all tasks
      const agent = db.getSubAgent(agentId);
      const runningCount = running.length;
      if (runningCount >= MAX_CONCURRENT_PER_USER) {
        throw new Error(
          `Maximum concurrent background tasks (${MAX_CONCURRENT_PER_USER}) reached. Wait for existing tasks to complete.`,
        );
      }

      const taskId = crypto.randomUUID();
      const now = Date.now();

      // Save task record
      db.saveBackgroundTask({
        id: taskId,
        userId,
        agentId,
        taskDescription: task,
        status: 'running',
        result: null,
        startedAt: now,
        completedAt: null,
        deliveredAt: null,
      });

      // Create abort controller
      const controller = new AbortController();
      controllers.set(taskId, controller);

      // Enqueue on the session queue (serialized per sub-agent, parallel across agents)
      queue
        .enqueue(`bg:${agentId}`, async () => {
          // Check if cancelled before starting
          if (controller.signal.aborted) {
            db.updateBackgroundTask(taskId, 'failed', 'Task was cancelled', Date.now());
            return;
          }

          try {
            // Adaptive timeout
            const estimate = timeoutEstimator?.estimate(task, agent?.tierPreference ?? 'auto');
            const timeoutMs = estimate?.timeoutMs ?? BACKGROUND_TIMEOUT_MS;
            const maxIterations = estimate?.estimatedIterations;

            const startTime = Date.now();

            const result = await runSubAgentV2({
              task,
              role: agent?.role ?? 'Background Agent',
              provider,
              tools,
              orientation,
              existingMessages,
              timeout: timeoutMs,
              maxIterations,
              timeoutEstimator,
            });

            // Save sub-agent messages for continuity
            for (const msg of result.messages) {
              lifecycle.saveMessage(agentId, msg.role, msg.content);
            }

            // Record metrics for the adaptive timeout estimator
            if (timeoutEstimator) {
              const durationMs = Date.now() - startTime;
              const taskType = timeoutEstimator.classifyTask(task);
              timeoutEstimator.record(userId, taskType, agent?.tierPreference ?? 'auto', durationMs, result.iterations, result.success);
            }

            // Update task record
            if (result.success) {
              db.updateBackgroundTask(taskId, 'completed', result.response, Date.now());
              lifecycle.recordTaskResult(agentId, true);

              // Auto-create/update template on success
              if (templates) {
                try {
                  if (templateId) {
                    templates.recordUsage(templateId, 1.0);
                  } else if (templateAutoCreate) {
                    const tags = extractTagsFromText(templateAutoCreate.role, task);
                    templates.create({
                      userId,
                      name: templateAutoCreate.role,
                      roleDescription: `${templateAutoCreate.role}: ${task}`,
                      defaultTools: templateAutoCreate.defaultTools,
                      defaultTier: templateAutoCreate.defaultTier as any,
                      tags,
                    });
                    logger.info('Auto-created role template', { role: templateAutoCreate.role });
                  }
                } catch {
                  // Template limit reached — non-fatal
                }
              }
            } else {
              db.updateBackgroundTask(taskId, 'failed', result.response, Date.now());
              lifecycle.recordTaskResult(agentId, false);
            }

            // Auto-suspend sub-agent once all its tasks are done
            // Check if there are any remaining running tasks for this agent
            const allTasks = db.getUserBackgroundTasks(userId);
            const hasRunningTasks = allTasks.some(
              (t) => t.agentId === agentId && t.status === 'running',
            );
            if (!hasRunningTasks) {
              lifecycle.suspend(agentId);
              logger.info('Sub-agent auto-suspended (task complete)', { agentId });
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            db.updateBackgroundTask(taskId, 'failed', errorMsg, Date.now());
            lifecycle.recordTaskResult(agentId, false);
            logger.error('Background task failed', { taskId, error: errorMsg });

            // Auto-suspend sub-agent on failure too
            const allTasks = db.getUserBackgroundTasks(userId);
            const hasRunningTasks = allTasks.some(
              (t) => t.agentId === agentId && t.status === 'running',
            );
            if (!hasRunningTasks) {
              lifecycle.suspend(agentId);
              logger.info('Sub-agent auto-suspended (task failed)', { agentId });
            }
          } finally {
            controllers.delete(taskId);
          }
        })
        .catch((err) => {
          // Queue-level error (e.g. queue stopped)
          logger.error('Background queue error', { taskId, error: err });
          controllers.delete(taskId);
        });

      return taskId;
    },

    getUndelivered(userId) {
      return db.getUndeliveredTasks(userId);
    },

    getAll(userId) {
      return db.getUserBackgroundTasks(userId);
    },

    markDelivered(taskId) {
      db.markTaskDelivered(taskId);
    },

    getStatus(taskId) {
      return db.getBackgroundTask(taskId);
    },

    cancel(taskId) {
      const controller = controllers.get(taskId);
      if (controller) {
        controller.abort();
        controllers.delete(taskId);
        db.updateBackgroundTask(taskId, 'failed', 'Task was cancelled', Date.now());
        return true;
      }
      return false;
    },

    cancelAll() {
      for (const [taskId, controller] of controllers) {
        controller.abort();
        db.updateBackgroundTask(taskId, 'failed', 'Task was cancelled (shutdown)', Date.now());
      }
      controllers.clear();
    },

    cleanupStale(olderThanMs) {
      const stale = db.getStaleBackgroundTasks(olderThanMs);
      for (const task of stale) {
        const controller = controllers.get(task.id);
        if (controller) {
          controller.abort();
        }
        db.updateBackgroundTask(task.id, 'failed', 'Task timed out (stale)', Date.now());
        controllers.delete(task.id);
      }
      return stale.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract keyword tags from role + task text. */
function extractTagsFromText(role: string, task: string): string[] {
  const text = `${role} ${task}`.toLowerCase();
  const words = text
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const unique = [...new Set(words)];
  return unique.slice(0, 10);
}
