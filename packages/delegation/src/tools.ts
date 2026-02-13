/**
 * Delegation Tools (v2)
 *
 * Creates 6 agent tools for the delegation system:
 *   1. delegate_task       — Create/reuse sub-agent for a foreground task
 *   2. delegate_background — Same but runs in the background
 *   3. delegate_to_existing — Send follow-up to an existing sub-agent
 *   4. list_sub_agents     — List active sub-agents
 *   5. manage_sub_agent    — Dismiss, revive, or kill a sub-agent
 *   6. manage_template     — CRUD on role templates
 */

import type { Tool, Provider } from '@tinyclaw/types';
import { logger } from '@tinyclaw/logger';
import type { DelegationStore, DelegationQueue } from './store.js';
import type {
  DelegationV2Config,
  LifecycleManager,
  TemplateManager,
  BackgroundRunner,
  OrientationContext,
} from './types.js';
import { buildOrientationContext } from './orientation.js';
import { runSubAgentV2 } from './runner.js';
import { createLifecycleManager } from './lifecycle.js';
import { createTemplateManager } from './templates.js';
import { createBackgroundRunner } from './background.js';
import { DELEGATION_TOOL_NAMES } from './handbook.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default safe tool set for sub-agents (read-only + sandboxed compute). */
const DEFAULT_SAFE_TOOLS = new Set([
  'heartware_read',
  'heartware_search',
  'heartware_list',
  'memory_recall',
  'execute_code',
]);

/** Foreground sub-agent timeout. */
const FOREGROUND_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Helper: filter tools for sub-agents
// ---------------------------------------------------------------------------

function filterToolsForSubAgent(
  allTools: Tool[],
  grantedNames: string[],
  defaultSafeSet: Set<string>,
): Tool[] {
  const allowed = new Set([...defaultSafeSet, ...grantedNames]);

  // Remove all delegation tools to prevent recursion
  for (const name of DELEGATION_TOOL_NAMES) {
    allowed.delete(name);
  }

  return allTools.filter((t) => allowed.has(t.name) && !DELEGATION_TOOL_NAMES.includes(t.name));
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export interface DelegationToolsConfig extends DelegationV2Config {
  queue: DelegationQueue;
}

export function createDelegationTools(config: DelegationToolsConfig): {
  tools: Tool[];
  lifecycle: LifecycleManager;
  templates: TemplateManager;
  background: BackgroundRunner;
} {
  const {
    orchestrator,
    allTools,
    db,
    heartwareContext,
    learning,
    queue,
    defaultSubAgentTools,
  } = config;

  const safeToolSet = defaultSubAgentTools
    ? new Set(defaultSubAgentTools)
    : DEFAULT_SAFE_TOOLS;

  const lifecycle = createLifecycleManager(db);
  const templates = createTemplateManager(db);
  const background = createBackgroundRunner(db, lifecycle, queue);

  // Helper: build orientation for the current user
  function getOrientation(userId: string): OrientationContext {
    return buildOrientationContext({
      heartwareContext,
      learning,
      db,
      userId,
    });
  }

  // Helper: select provider for a tier preference
  async function selectProvider(tier?: string): Promise<Provider> {
    if (tier && tier !== 'auto') {
      const registry = orchestrator.getRegistry();
      const provider = registry.getForTier(tier as any);
      if (provider) return provider;
    }
    return orchestrator.selectActiveProvider();
  }

  // =========================================================================
  // 1. delegate_task
  // =========================================================================

  const delegateTask: Tool = {
    name: 'delegate_task',
    description:
      'Delegate a focused task to a sub-agent. Reuses existing agents when possible. ' +
      'Sub-agents persist and can be sent follow-up tasks.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task to delegate' },
        role: { type: 'string', description: 'Role description (e.g. "Technical Research Analyst")' },
        tier: { type: 'string', description: 'Provider tier: simple, moderate, complex, reasoning, or auto' },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional tool names to grant beyond the default safe set',
        },
        template_id: { type: 'string', description: 'Optional: use a specific role template' },
        user_id: { type: 'string', description: 'User ID (injected by system)' },
      },
      required: ['task', 'role'],
    },
    async execute(args) {
      const task = String(args.task || '');
      const role = String(args.role || '');
      const tier = String(args.tier || 'auto');
      const additionalTools = (args.tools as string[]) || [];
      const templateId = args.template_id as string | undefined;
      const userId = String(args.user_id || 'default-user');

      if (!task) return 'Error: task is required.';
      if (!role) return 'Error: role is required.';

      try {
        const orientation = getOrientation(userId);
        const provider = await selectProvider(tier);
        const subTools = filterToolsForSubAgent(allTools, additionalTools, safeToolSet);

        // Check for template match
        let usedTemplateId = templateId;
        if (!usedTemplateId) {
          const match = templates.findBestMatch(userId, `${role} ${task}`);
          if (match) {
            usedTemplateId = match.id;
            logger.info('Matched role template', { templateId: match.id, name: match.name });
          }
        }

        // Check for reusable sub-agent
        let agent = lifecycle.findReusable(userId, role);
        let isReuse = false;

        if (agent) {
          isReuse = true;
          logger.info('Reusing sub-agent', { agentId: agent.id, role: agent.role });
        } else {
          agent = lifecycle.create({
            userId,
            role,
            toolsGranted: [...safeToolSet, ...additionalTools],
            tierPreference: tier !== 'auto' ? (tier as any) : undefined,
            templateId: usedTemplateId,
            orientation,
          });
          logger.info('Created sub-agent', { agentId: agent.id, role });
        }

        // Load existing messages for continuity
        const existingMessages = isReuse ? lifecycle.getMessages(agent.id) : [];

        const result = await runSubAgentV2({
          task,
          role,
          provider,
          tools: subTools,
          orientation,
          existingMessages,
          timeout: FOREGROUND_TIMEOUT_MS,
        });

        // Persist sub-agent messages
        for (const msg of result.messages) {
          lifecycle.saveMessage(agent.id, msg.role, msg.content);
        }

        // Record performance
        lifecycle.recordTaskResult(agent.id, result.success);

        // Auto-create/update template
        if (result.success && usedTemplateId) {
          const score = result.success ? 1.0 : 0.0;
          templates.recordUsage(usedTemplateId, score);
        } else if (result.success && !usedTemplateId) {
          // Auto-create template from successful delegation
          try {
            const tags = extractTags(role, task);
            templates.create({
              userId,
              name: role,
              roleDescription: `${role}: ${task}`,
              defaultTools: [...safeToolSet, ...additionalTools],
              defaultTier: tier !== 'auto' ? (tier as any) : undefined,
              tags,
            });
            logger.info('Auto-created role template', { role });
          } catch {
            // Template limit reached — non-fatal
          }
        }

        if (result.success) {
          return (
            `Sub-agent (${role}) completed [${isReuse ? 'reused' : 'new'}, provider: ${result.providerId}]:\n\n` +
            result.response
          );
        }
        return `Sub-agent (${role}) failed [provider: ${result.providerId}]: ${result.response}`;
      } catch (err) {
        return `Error delegating task: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    },
  };

  // =========================================================================
  // 2. delegate_background
  // =========================================================================

  const delegateBackground: Tool = {
    name: 'delegate_background',
    description:
      'Delegate a task to run in the background. Returns immediately so you can keep chatting. ' +
      'The result will appear in your next message.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task to delegate' },
        role: { type: 'string', description: 'Role description' },
        tier: { type: 'string', description: 'Provider tier: simple, moderate, complex, reasoning, or auto' },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional tool names to grant',
        },
        user_id: { type: 'string', description: 'User ID (injected by system)' },
      },
      required: ['task', 'role'],
    },
    async execute(args) {
      const task = String(args.task || '');
      const role = String(args.role || '');
      const tier = String(args.tier || 'auto');
      const additionalTools = (args.tools as string[]) || [];
      const userId = String(args.user_id || 'default-user');

      if (!task) return 'Error: task is required.';
      if (!role) return 'Error: role is required.';

      try {
        const orientation = getOrientation(userId);
        const provider = await selectProvider(tier);
        const subTools = filterToolsForSubAgent(allTools, additionalTools, safeToolSet);

        // Check for reusable or create new
        let agent = lifecycle.findReusable(userId, role);

        if (!agent) {
          agent = lifecycle.create({
            userId,
            role,
            toolsGranted: [...safeToolSet, ...additionalTools],
            tierPreference: tier !== 'auto' ? (tier as any) : undefined,
            orientation,
          });
        }

        const existingMessages = lifecycle.getMessages(agent.id);

        const taskId = background.start({
          userId,
          agentId: agent.id,
          task,
          provider,
          tools: subTools,
          orientation,
          existingMessages,
        });

        return (
          `Background task started [id: ${taskId}]\n` +
          `Sub-agent: ${agent.role} (${agent.id})\n` +
          `The result will be delivered when ready.`
        );
      } catch (err) {
        return `Error starting background task: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    },
  };

  // =========================================================================
  // 3. delegate_to_existing
  // =========================================================================

  const delegateToExisting: Tool = {
    name: 'delegate_to_existing',
    description:
      'Send a follow-up task to an already-alive sub-agent. The sub-agent retains its conversation history.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The sub-agent ID' },
        task: { type: 'string', description: 'The follow-up task' },
        background: { type: 'boolean', description: 'Run in background (default: false)' },
        user_id: { type: 'string', description: 'User ID (injected by system)' },
      },
      required: ['agent_id', 'task'],
    },
    async execute(args) {
      const agentId = String(args.agent_id || '');
      const task = String(args.task || '');
      const runInBackground = Boolean(args.background);
      const userId = String(args.user_id || 'default-user');

      if (!agentId) return 'Error: agent_id is required.';
      if (!task) return 'Error: task is required.';

      const agent = lifecycle.get(agentId);
      if (!agent) return `Error: Sub-agent ${agentId} not found.`;
      if (agent.status !== 'active') return `Error: Sub-agent ${agentId} is ${agent.status}. Revive it first.`;

      try {
        const orientation = getOrientation(userId);
        const provider = await selectProvider(agent.tierPreference ?? undefined);
        const subTools = filterToolsForSubAgent(allTools, agent.toolsGranted, safeToolSet);
        const existingMessages = lifecycle.getMessages(agentId);

        if (runInBackground) {
          const taskId = background.start({
            userId,
            agentId,
            task,
            provider,
            tools: subTools,
            orientation,
            existingMessages,
          });
          return `Background follow-up started [task: ${taskId}] for sub-agent ${agent.role} (${agentId})`;
        }

        const result = await runSubAgentV2({
          task,
          role: agent.role,
          provider,
          tools: subTools,
          orientation,
          existingMessages,
          timeout: FOREGROUND_TIMEOUT_MS,
        });

        // Persist messages
        for (const msg of result.messages) {
          lifecycle.saveMessage(agentId, msg.role, msg.content);
        }

        lifecycle.recordTaskResult(agentId, result.success);

        if (result.success) {
          return `Sub-agent (${agent.role}) completed follow-up:\n\n${result.response}`;
        }
        return `Sub-agent (${agent.role}) failed follow-up: ${result.response}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    },
  };

  // =========================================================================
  // 4. list_sub_agents
  // =========================================================================

  const listSubAgents: Tool = {
    name: 'list_sub_agents',
    description: 'List your sub-agents with their status, performance, and last activity.',
    parameters: {
      type: 'object',
      properties: {
        include_deleted: { type: 'boolean', description: 'Include dismissed agents (default: false)' },
        user_id: { type: 'string', description: 'User ID (injected by system)' },
      },
    },
    async execute(args) {
      const includeDeleted = Boolean(args.include_deleted);
      const userId = String(args.user_id || 'default-user');

      const agents = db.getAllSubAgents(userId, includeDeleted);

      if (agents.length === 0) {
        return 'No sub-agents found.';
      }

      const lines = agents.map((a) => {
        const perf = `${(a.performanceScore * 100).toFixed(0)}%`;
        const tasks = `${a.successfulTasks}/${a.totalTasks} tasks`;
        const lastActive = new Date(a.lastActiveAt).toISOString().slice(0, 16);
        return `- [${a.status}] ${a.role} (${a.id})\n  Performance: ${perf} | ${tasks} | Last active: ${lastActive}`;
      });

      return `Sub-agents (${agents.length}):\n${lines.join('\n')}`;
    },
  };

  // =========================================================================
  // 5. manage_sub_agent
  // =========================================================================

  const manageSubAgent: Tool = {
    name: 'manage_sub_agent',
    description: 'Manage sub-agent lifecycle: dismiss (soft-delete), revive, or kill (permanent).',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The sub-agent ID' },
        action: {
          type: 'string',
          description: 'Action: dismiss (soft-delete, 14-day retention), revive, or kill (permanent)',
        },
      },
      required: ['agent_id', 'action'],
    },
    async execute(args) {
      const agentId = String(args.agent_id || '');
      const action = String(args.action || '');

      if (!agentId) return 'Error: agent_id is required.';
      if (!['dismiss', 'revive', 'kill'].includes(action)) {
        return 'Error: action must be dismiss, revive, or kill.';
      }

      const agent = lifecycle.get(agentId);
      if (!agent) return `Error: Sub-agent ${agentId} not found.`;

      switch (action) {
        case 'dismiss': {
          lifecycle.suspend(agentId);
          return `Sub-agent "${agent.role}" (${agentId}) dismissed. Can be revived within 14 days.`;
        }
        case 'revive': {
          const revived = lifecycle.revive(agentId);
          if (!revived) return `Error: Cannot revive ${agentId}. It may not be dismissed or has expired.`;
          return `Sub-agent "${revived.role}" (${agentId}) revived and active again.`;
        }
        case 'kill': {
          lifecycle.kill(agentId);
          return `Sub-agent "${agent.role}" (${agentId}) permanently deleted.`;
        }
        default:
          return 'Error: Unknown action.';
      }
    },
  };

  // =========================================================================
  // 6. manage_template
  // =========================================================================

  const manageTemplate: Tool = {
    name: 'manage_template',
    description: 'Manage role templates (job postings): list, update, or delete.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action: list, update, or delete',
        },
        template_id: { type: 'string', description: 'Template ID (required for update/delete)' },
        updates: {
          type: 'object',
          description: 'Fields to update: name, roleDescription, defaultTools, defaultTier, tags',
        },
        user_id: { type: 'string', description: 'User ID (injected by system)' },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = String(args.action || '');
      const templateId = args.template_id as string | undefined;
      const updates = args.updates as Record<string, unknown> | undefined;
      const userId = String(args.user_id || 'default-user');

      switch (action) {
        case 'list': {
          const all = templates.list(userId);
          if (all.length === 0) return 'No role templates found.';

          const lines = all.map((t) => {
            const perf = `${(t.avgPerformance * 100).toFixed(0)}%`;
            return (
              `- ${t.name} (${t.id})\n` +
              `  Used ${t.timesUsed}x | Avg performance: ${perf}\n` +
              `  Tags: ${t.tags.length > 0 ? t.tags.join(', ') : 'none'}`
            );
          });

          return `Role templates (${all.length}):\n${lines.join('\n')}`;
        }

        case 'update': {
          if (!templateId) return 'Error: template_id is required for update.';
          if (!updates) return 'Error: updates object is required.';

          const result = templates.update(templateId, updates as any);
          if (!result) return `Error: Template ${templateId} not found.`;
          return `Template "${result.name}" updated successfully.`;
        }

        case 'delete': {
          if (!templateId) return 'Error: template_id is required for delete.';
          templates.delete(templateId);
          return `Template ${templateId} deleted.`;
        }

        default:
          return 'Error: action must be list, update, or delete.';
      }
    },
  };

  return {
    tools: [
      delegateTask,
      delegateBackground,
      delegateToExisting,
      listSubAgents,
      manageSubAgent,
      manageTemplate,
    ],
    lifecycle,
    templates,
    background,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract keyword tags from role + task text. */
function extractTags(role: string, task: string): string[] {
  const text = `${role} ${task}`.toLowerCase();
  const words = text
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  // Deduplicate and take top 10
  const unique = [...new Set(words)];
  return unique.slice(0, 10);
}
