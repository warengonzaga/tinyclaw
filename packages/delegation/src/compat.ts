/**
 * V1 Compatibility — createDelegationTool
 *
 * Preserves the original single-tool delegation factory for backward
 * compatibility. Will be replaced by createDelegationTools() in Phase 8.
 */

import { logger } from '@tinyclaw/logger';
import type { ProviderOrchestrator, QueryTier } from '@tinyclaw/router';
import type { Tool } from '@tinyclaw/types';
import { runSubAgent } from './runner.js';
import type { DelegationToolConfig } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SAFE_TOOLS = [
  'heartware_read',
  'heartware_search',
  'heartware_list',
  'memory_recall',
];

// ---------------------------------------------------------------------------
// V1 Delegation Tool Factory
// ---------------------------------------------------------------------------

export function createDelegationTool(config: DelegationToolConfig): Tool {
  const { orchestrator, allTools } = config;
  const safeToolNames = config.defaultSubAgentTools ?? DEFAULT_SAFE_TOOLS;

  return {
    name: 'delegate_task',
    description:
      'Delegate a task to an ephemeral sub-agent. The sub-agent runs independently with ' +
      'a specific role, completes the task, and returns the result. Use this for research, ' +
      'analysis, data gathering, summarization, or any task that benefits from focused ' +
      'single-purpose execution. The sub-agent has read-only access to heartware and ' +
      'memory by default. You can optionally grant additional tools and route to a ' +
      'specific provider tier (e.g., "reasoning" for complex analysis).',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Clear, detailed description of what the sub-agent should accomplish',
        },
        role: {
          type: 'string',
          description:
            'Role/specialty for the sub-agent (e.g., "Research Specialist", ' +
            '"Data Analyst", "Content Summarizer")',
        },
        tier: {
          type: 'string',
          description:
            'Optional complexity tier for provider routing. If omitted, ' +
            'the task text is auto-classified.',
          enum: ['simple', 'moderate', 'complex', 'reasoning'],
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional additional tool names to grant the sub-agent beyond the ' +
            'default read-only set (heartware_read, heartware_search, heartware_list, memory_recall)',
        },
      },
      required: ['task', 'role'],
    },

    async execute(args: Record<string, unknown>): Promise<string> {
      const task = args.task as string;
      const role = args.role as string;
      const tierOverride = args.tier as string | undefined;
      const additionalToolNames = (args.tools as string[]) || [];

      if (!task?.trim()) {
        return 'Error: task must be a non-empty string.';
      }
      if (!role?.trim()) {
        return 'Error: role must be a non-empty string.';
      }

      // 1. Resolve provider
      let provider;
      try {
        if (tierOverride) {
          provider = orchestrator.getRegistry().getForTier(tierOverride as QueryTier);
        } else {
          const routeResult = await orchestrator.routeWithHealth(task);
          provider = routeResult.provider;
        }
      } catch (err) {
        return `Error resolving provider: ${(err as Error).message}`;
      }

      logger.info('Delegating task', {
        role,
        tier: tierOverride ?? 'auto',
        provider: provider.id,
        additionalTools: additionalToolNames,
      });

      // 2. Assemble tool set
      const allowedToolNames = new Set([...safeToolNames, ...additionalToolNames]);
      allowedToolNames.delete('delegate_task');

      const subAgentTools = allTools.filter((t) => allowedToolNames.has(t.name));

      // 3. Run sub-agent
      const result = await runSubAgent({
        task,
        role,
        provider,
        tools: subAgentTools,
      });

      // 4. Format result
      if (result.success) {
        return (
          `[Sub-agent (${role}) completed in ${result.iterations} iteration(s) via ${result.providerId}]\n\n` +
          result.response
        );
      } else {
        return (
          `[Sub-agent (${role}) failed after ${result.iterations} iteration(s)]\n\n` +
          `Error: ${result.response}`
        );
      }
    },
  };
}
