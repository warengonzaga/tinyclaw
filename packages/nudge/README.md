# @tinyclaw/nudge

Proactive notification engine for [Tiny Claw](https://github.com/warengonzaga/tinyclaw) — your autonomous AI companion.

Queues, schedules, and delivers nudge notifications from the agent to users across all connected channels. Respects user preferences including quiet hours, rate limiting, and per-category suppression.

## Usage

```ts
import { createNudgeEngine, wireNudgeToIntercom, createNudgeTools } from '@tinyclaw/nudge';

// Create the engine with an outbound gateway
const nudgeEngine = createNudgeEngine({ gateway });

// Schedule a nudge
nudgeEngine.schedule({
  userId: 'web:owner',
  category: 'reminder',
  content: 'Don't forget to review the pull request!',
  priority: 'normal',
  deliverAfter: Date.now() + 30 * 60_000, // 30 minutes from now
});

// Flush pending nudges (called by Pulse on a 1-minute interval)
await nudgeEngine.flush();

// Wire intercom events to auto-generate nudges
const unwire = wireNudgeToIntercom(nudgeEngine, intercom);

// Create agent tools (send_nudge, check_pending_nudges, cancel_nudge)
const tools = createNudgeTools(nudgeEngine);
```

## Nudge Categories

| Category | Description |
|---|---|
| `task_complete` | A background task finished successfully |
| `task_failed` | A background task failed (auto-urgent) |
| `reminder` | Scheduled reminder from the agent |
| `check_in` | Periodic check-in / wellness nudge |
| `insight` | Agent-initiated insight or suggestion |
| `system` | System-level notification |
| `software_update` | A new Tiny Claw version is available |
| `agent_initiated` | Free-form agent-initiated outreach |

## User Preferences

Users can control their notification experience via config or the `/api/nudge/preferences` endpoint:

- **enabled** — master on/off switch
- **quietHoursStart / quietHoursEnd** — suppress non-urgent nudges during these hours (e.g. `22:00`–`08:00`)
- **maxPerHour** — rate limit (default: 5); urgent nudges bypass this
- **suppressedCategories** — opt out of specific categories

## Agent Tools

The engine provides three tools for the agent to use during conversation:

- **send_nudge** — proactively message a user with optional delay, category, and priority
- **check_pending_nudges** — inspect the queue to avoid spamming
- **cancel_nudge** — cancel a pending nudge by ID before delivery

## Part of Tiny Claw

This package is part of the [Tiny Claw](https://github.com/warengonzaga/tinyclaw) monorepo.

## License

GPL-3.0 — see [LICENSE](../../LICENSE) for details.
