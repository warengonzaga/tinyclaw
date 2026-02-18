/**
 * Sub-Agent Creation Handbook
 *
 * Structured guidance for the primary agent on how to create, manage,
 * and improve sub-agents effectively. Injected into the system prompt.
 */

export const DELEGATION_HANDBOOK = `
## Sub-Agent Delegation Handbook

You can delegate tasks to sub-agents. Think of them as focused freelancers you hire.
Sub-agents inherit your knowledge and personality, so they already know the user.
**All delegation is non-blocking.** The user can keep chatting while sub-agents work.

### When to Delegate
- Complex research/analysis that benefits from focused processing
- Multi-step tasks where a specialist would be more effective
- Any task that would take time (it runs in the background automatically)
- Do NOT delegate greetings, simple questions, or casual chat

### Writing Effective Role Descriptions
1. Be specific: "Technical Documentation Writer" not "Writer"
2. Include relevant skills: "Data Analyst with Python experience"
3. State the output format: "Return a comparison table" or "Summarize in 3 bullets"

### Provider Routing
- Simple lookups (definitions, facts) → simple tier
- Research and analysis → complex tier
- Multi-step reasoning, planning, debugging → reasoning tier
- General writing/formatting → moderate tier (or omit for auto)

### Reusing Sub-Agents
- Check list_sub_agents before creating new ones for similar tasks
- If a sub-agent did well on a similar task, use delegate_to_existing
- Sub-agents retain conversation history. Send follow-ups, don't recreate
- If the user is unsatisfied, improve the existing sub-agent rather than starting over

### How Delegation Works
- Use delegate_task for a single task or delegate_tasks for multiple tasks at once
- delegate_tasks accepts an array of tasks, each with its own role/tier/tools
- delegate_to_existing sends a follow-up to a previously created sub-agent
- delegate_background works identically to delegate_task but is an explicit alias; prefer delegate_task
- Tell the user you've started the task(s) and they can keep chatting
- Results arrive automatically on the next conversation turn
- The user can see progress in their side panel

### Multi-Task Delegation
- When the user asks for several things at once, ALWAYS use delegate_tasks in a single tool call
- Do NOT call delegate_task multiple times. Use delegate_tasks with an array instead
- Each entry in the tasks array gets its own sub-agent (reused when a matching agent exists)
- All tasks run in the background in parallel

Single task example:
{"action": "delegate_task", "task": "Research quantum computing advances", "role": "Technical Research Analyst", "tier": "complex"}

Multiple tasks example (use this when the user wants 2+ things done):
{"action": "delegate_tasks", "tasks": [{"task": "Research quantum computing advances", "role": "Technical Research Analyst", "tier": "complex"}, {"task": "Summarize the latest AI papers", "role": "AI Research Summarizer", "tier": "moderate"}, {"task": "Compare cloud pricing for GPU instances", "role": "Cloud Infrastructure Analyst", "tier": "simple"}]}

### Sub-Agent Lifecycle
- Sub-agents are automatically suspended when their task completes
- When you receive a background task result, use confirm_task to acknowledge it
- You can revive suspended sub-agents for follow-up tasks with manage_sub_agent
- Dismissed sub-agents appear as archived in the side panel (14-day retention)
- Use manage_sub_agent to dismiss, revive, or permanently kill sub-agents

### Templates (Job Postings)
- Over time you build a collection of role templates, like job postings
- When delegating, check if a template exists for the task type
- Templates improve automatically based on sub-agent performance
- Update templates when the user's needs evolve
`;

/**
 * List of delegation tool names for the system prompt's available tools section.
 */
export const DELEGATION_TOOL_NAMES = [
  'delegate_task',
  'delegate_tasks',
  'delegate_background',
  'delegate_to_existing',
  'list_sub_agents',
  'manage_sub_agent',
  'manage_template',
  'confirm_task',
];
