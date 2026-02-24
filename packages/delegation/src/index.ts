/**
 * Delegation Module (@tinyclaw/delegation)
 *
 * Re-exports all delegation functionality. Backward compatible with v1 imports.
 */

// V2 exports — background
export { createBackgroundRunner } from './background.js';
export type { Blackboard, BlackboardProblem } from './blackboard.js';
// V3 exports — blackboard
export { createBlackboard } from './blackboard.js';
// V1 createDelegationTool (backward compatible)
export { createDelegationTool } from './compat.js';
// V2 exports — handbook
export { DELEGATION_HANDBOOK, DELEGATION_TOOL_NAMES } from './handbook.js';
// V2 exports — lifecycle
export { createLifecycleManager } from './lifecycle.js';
// V2 exports — orientation
export { buildOrientationContext, formatOrientation } from './orientation.js';
// V1 compatible exports (runner + types)
// V2 exports — runner
export { runSubAgent, runSubAgentV2 } from './runner.js';
// Store interfaces (DelegationStore, DelegationQueue, DelegationIntercom)
export type { DelegationIntercom, DelegationQueue, DelegationStore } from './store.js';
// V2 exports — templates
export { createTemplateManager } from './templates.js';
export type { ExtensionDecision, TimeoutEstimate, TimeoutEstimator } from './timeout-estimator.js';
// V3 exports — timeout estimator
export { createTimeoutEstimator } from './timeout-estimator.js';
export type { DelegationToolsConfig } from './tools.js';
// V2 exports — tools (6-tool factory)
export { createDelegationTools } from './tools.js';
// V2 exports — types
export type {
  BackgroundRunner,
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  DelegationContext,
  DelegationToolConfig,
  DelegationV2Config,
  LifecycleManager,
  OrientationContext,
  RoleTemplate,
  SubAgentConfig,
  SubAgentRecord,
  SubAgentResult,
  SubAgentRunConfig,
  SubAgentRunResult,
  SubAgentStatus,
  TemplateManager,
} from './types.js';
