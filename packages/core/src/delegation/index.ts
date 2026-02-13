/**
 * Delegation Module (v2)
 *
 * Re-exports all delegation functionality. Backward compatible with v1 imports.
 */

// V1 compatible exports (runner + types)
export { runSubAgent } from './runner.js';
export type {
  SubAgentConfig,
  SubAgentResult,
  DelegationToolConfig,
} from './types.js';

// V2 exports — runner
export { runSubAgentV2 } from './runner.js';

// V2 exports — orientation
export { buildOrientationContext, formatOrientation } from './orientation.js';

// V2 exports — handbook
export { DELEGATION_HANDBOOK, DELEGATION_TOOL_NAMES } from './handbook.js';

// V2 exports — lifecycle
export { createLifecycleManager } from './lifecycle.js';

// V2 exports — templates
export { createTemplateManager } from './templates.js';

// V2 exports — background
export { createBackgroundRunner } from './background.js';

// V2 exports — tools (6-tool factory)
export { createDelegationTools } from './tools.js';
export type { DelegationToolsConfig } from './tools.js';

// V2 exports — types
export type {
  SubAgentStatus,
  SubAgentRecord,
  RoleTemplate,
  BackgroundTaskStatus,
  BackgroundTaskRecord,
  OrientationContext,
  DelegationV2Config,
  SubAgentRunConfig,
  SubAgentRunResult,
  DelegationContext,
  LifecycleManager,
  TemplateManager,
  BackgroundRunner,
} from './types.js';

// V1 createDelegationTool (backward compatible)
export { createDelegationTool } from './compat.js';
