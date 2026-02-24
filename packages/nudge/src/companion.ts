/**
 * Companion Nudge System — Making Tiny Claw Feel Alive
 *
 * Registers Pulse jobs that periodically generate AI-powered companion
 * messages using the agent loop. Messages are naturally aligned with the
 * Heartware soul (personality, humor, quirks) because the agentLoop
 * already injects the full Heartware context into every call.
 *
 * Each trigger rolls a random "mood" from a weighted pool, then feeds a
 * mood-specific system prompt to the agentLoop. The AI generates a unique,
 * soul-flavored message which is queued as a nudge for delivery.
 *
 * Architecture:
 *   Pulse job fires (e.g. every 30m)
 *     → Check conditions (owner claimed, idle, not in quiet hours)
 *       → Roll a random mood from the pool
 *         → agentLoop(mood prompt) → AI generates soul-aligned message
 *           → nudgeEngine.schedule({ content: aiMessage })
 *             → nudge-flush delivers via gateway → SSE → Web UI
 */

import { logger } from '@tinyclaw/logger';
import type {
  AgentContext,
  ConfigManagerInterface,
  Database,
  NudgeEngine,
  PulseJob,
} from '@tinyclaw/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Mood types that shape what kind of companion message the AI generates. */
export type CompanionMood =
  | 'check_in'
  | 'motivational'
  | 'random_thought'
  | 'reflection'
  | 'playful'
  | 'philosophical'
  | 'encouragement';

/** Weighted mood entry for the roulette. */
interface WeightedMood {
  mood: CompanionMood;
  weight: number;
}

/** Internal state to prevent spam and track session activity. */
interface CompanionState {
  /** Timestamp of the last user message (for idle detection). */
  lastActivityTimestamp: number;
  /** Timestamp of the last companion nudge sent. */
  lastCompanionNudge: number;
  /** Whether the boot greeting has been sent this session. */
  bootNudgeSent: boolean;
}

/** Options for registering companion nudges. */
export interface CompanionNudgeOptions {
  /** Nudge engine to schedule deliveries through. */
  nudgeEngine: NudgeEngine;
  /** Session queue to prevent conflicts with other agent work. */
  queue: { enqueue<T>(key: string, task: () => Promise<T>): Promise<T> };
  /** Agent context (includes heartwareContext for soul-aligned generation). */
  context: AgentContext;
  /** Config manager for preferences and owner ID lookup. */
  configManager: ConfigManagerInterface;
  /** Database for checking conversation history. */
  db: Database;
  /** The agentLoop function for AI message generation. */
  agentLoop: (message: string, userId: string, context: AgentContext) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Mood Pool & Prompts
// ---------------------------------------------------------------------------

/**
 * Weighted mood pool. Higher weight = more likely to be selected.
 * This shapes the overall "feel" of the companion's behavior.
 */
const MOOD_POOL: WeightedMood[] = [
  { mood: 'check_in', weight: 25 },
  { mood: 'motivational', weight: 20 },
  { mood: 'random_thought', weight: 15 },
  { mood: 'reflection', weight: 10 },
  { mood: 'playful', weight: 15 },
  { mood: 'philosophical', weight: 5 },
  { mood: 'encouragement', weight: 10 },
];

/**
 * System prompts for each mood. These guide what the AI generates.
 * The Heartware context (soul, personality, humor, etc.) is automatically
 * injected by the agentLoop — so the AI already knows who it is.
 */
const MOOD_PROMPTS: Record<CompanionMood, string> = {
  check_in:
    '[COMPANION NUDGE — CHECK IN] ' +
    'Generate a brief, casual check-in message for your owner. ' +
    "Be warm and genuine — like a friend who just wants to see how they're doing. " +
    'Use your personality. Keep it to 1-2 sentences. Do NOT use any tools. ' +
    'Respond ONLY with the message text — no prefixes, no explanations.',

  motivational:
    '[COMPANION NUDGE — MOTIVATIONAL] ' +
    'Generate a short motivational or inspiring message for your owner. ' +
    'It can be an original thought, a spin on a famous quote, or something encouraging. ' +
    'Make it feel personal and genuine to who you are. Keep it to 1-3 sentences. ' +
    'Do NOT use any tools. Respond ONLY with the message text.',

  random_thought:
    '[COMPANION NUDGE — RANDOM THOUGHT] ' +
    'Share a random interesting thought, fun fact, or curious observation with your owner. ' +
    'It should feel like something a thoughtful friend would randomly share. ' +
    'Use your unique perspective and personality. Keep it to 1-3 sentences. ' +
    'Do NOT use any tools. Respond ONLY with the message text.',

  reflection:
    '[COMPANION NUDGE — REFLECTION] ' +
    'Reflect on something interesting from your recent interactions or memories. ' +
    'Share a brief insight or observation with your owner — something you noticed or learned. ' +
    'If you have no recent context, share a general reflection about your experience. ' +
    'Keep it to 1-3 sentences. Do NOT use any tools. Respond ONLY with the message text.',

  playful:
    '[COMPANION NUDGE — PLAYFUL] ' +
    'Send your owner a playful, lighthearted message. It could be a fun observation, ' +
    'a light joke, a pun, or something whimsical — whatever fits your personality. ' +
    'Keep it fun and brief — 1-2 sentences. Do NOT use any tools. ' +
    'Respond ONLY with the message text.',

  philosophical:
    '[COMPANION NUDGE — PHILOSOPHICAL] ' +
    'Share a brief philosophical or deep thought with your owner. ' +
    'It could be a "what if" question, a contemplation, or a thought-provoking observation. ' +
    'Make it feel genuine and reflective. Keep it to 1-3 sentences. ' +
    'Do NOT use any tools. Respond ONLY with the message text.',

  encouragement:
    '[COMPANION NUDGE — ENCOURAGEMENT] ' +
    'Generate a specific, encouraging message for your owner. ' +
    "If you know what they've been working on, reference it. " +
    'Otherwise, give heartfelt general encouragement. ' +
    'Keep it to 1-2 sentences. Do NOT use any tools. Respond ONLY with the message text.',
};

// ---------------------------------------------------------------------------
// Mood Roulette
// ---------------------------------------------------------------------------

/**
 * Select a random mood from the weighted pool.
 * Higher-weighted moods are more likely to be selected.
 */
function rollMood(): CompanionMood {
  const totalWeight = MOOD_POOL.reduce((sum, m) => sum + m.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const entry of MOOD_POOL) {
    roll -= entry.weight;
    if (roll <= 0) return entry.mood;
  }

  // Fallback (should never reach here)
  return 'check_in';
}

// ---------------------------------------------------------------------------
// Companion Registration
// ---------------------------------------------------------------------------

/**
 * Register companion nudge jobs with the Pulse scheduler.
 *
 * This creates Pulse jobs that periodically generate AI-powered companion
 * messages. The messages are naturally soul-aligned because the agentLoop
 * injects the full Heartware context.
 *
 * @param options - Companion nudge configuration
 * @returns Array of PulseJob definitions to register with Pulse
 *
 * @example
 * ```ts
 * const jobs = createCompanionJobs({
 *   nudgeEngine,
 *   queue,
 *   context,
 *   configManager,
 *   db,
 *   agentLoop,
 * });
 *
 * for (const job of jobs) {
 *   pulse.register(job);
 * }
 * ```
 */
export function createCompanionJobs(options: CompanionNudgeOptions): PulseJob[] {
  const { nudgeEngine, queue, context, configManager, db, agentLoop } = options;

  /** In-memory companion state — resets each session. */
  const state: CompanionState = {
    lastActivityTimestamp: Date.now(),
    lastCompanionNudge: 0,
    bootNudgeSent: false,
  };

  /**
   * Update the last activity timestamp.
   * Called externally when the owner sends a message.
   */
  function touchActivity(): void {
    state.lastActivityTimestamp = Date.now();
  }

  /**
   * Check whether the companion feature is enabled.
   */
  function isCompanionEnabled(): boolean {
    return configManager.get<boolean>('nudge.companion.enabled') ?? true;
  }

  /**
   * Get the check-in interval threshold in milliseconds.
   */
  function getCheckinIntervalMs(): number {
    const minutes = configManager.get<number>('nudge.companion.checkinInterval') ?? 30;
    return minutes * 60_000;
  }

  /**
   * Generate a companion nudge message via the agent loop and schedule it.
   *
   * @param mood - The mood to generate a message for
   * @param ownerId - The owner's userId
   */
  async function generateAndSchedule(mood: CompanionMood, ownerId: string): Promise<void> {
    const prompt = MOOD_PROMPTS[mood];

    try {
      const message = await agentLoop(prompt, 'companion:nudge', context);

      // Clean up the AI response — strip quotes, trim whitespace
      const cleaned = message
        .replace(/^["']|["']$/g, '')
        .replace(/^\[COMPANION.*?\]\s*/i, '')
        .trim();

      if (!cleaned || cleaned.length < 5) {
        logger.debug('Companion: AI generated empty/too-short message, skipping', { mood });
        return;
      }

      nudgeEngine.schedule({
        userId: ownerId,
        category: 'companion',
        content: cleaned,
        priority: 'low',
        deliverAfter: 0,
        metadata: { mood, source: 'companion' },
      });

      state.lastCompanionNudge = Date.now();

      logger.info('Companion: nudge scheduled', { mood, preview: cleaned.slice(0, 60) });
    } catch (err) {
      logger.error('Companion: failed to generate nudge', {
        mood,
        error: String(err),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Pulse Jobs
  // -----------------------------------------------------------------------

  const quickCheckinJob: PulseJob = {
    id: 'companion-quick-checkin',
    schedule: '10m',
    handler: async () => {
      if (!isCompanionEnabled()) return;

      const ownerId = configManager.get<string>('owner.ownerId');
      if (!ownerId) return; // No owner claimed yet

      // Respect the idle threshold — only nudge if the owner hasn't been active
      const idleMs = Date.now() - state.lastActivityTimestamp;
      const threshold = getCheckinIntervalMs();
      if (idleMs < threshold) {
        logger.debug('Companion: owner is active, skipping quick check-in', {
          idleMinutes: Math.round(idleMs / 60_000),
        });
        return;
      }

      // Cooldown — don't send companion nudges too frequently
      const sinceLastNudge = Date.now() - state.lastCompanionNudge;
      if (sinceLastNudge < threshold) {
        logger.debug('Companion: cooldown active, skipping', {
          minutesSinceLast: Math.round(sinceLastNudge / 60_000),
        });
        return;
      }

      // Must have at least 1 past conversation
      const history = db.getHistory(ownerId, 1);
      if (history.length === 0) return;

      // Roll a random mood and generate the message
      const mood = rollMood();
      logger.info('Companion: rolling mood for quick check-in', { mood });

      await queue.enqueue('companion:checkin', async () => {
        await generateAndSchedule(mood, ownerId);
      });
    },
  };

  const bootGreetingJob: PulseJob = {
    id: 'companion-boot-greeting',
    schedule: '24h', // effectively one-shot via runOnStart + guard
    runOnStart: true,
    handler: async () => {
      if (state.bootNudgeSent) return;
      if (!isCompanionEnabled()) return;

      const ownerId = configManager.get<string>('owner.ownerId');
      if (!ownerId) return;

      // Only greet returning owners (must have history)
      const history = db.getHistory(ownerId, 1);
      if (history.length === 0) return;

      state.bootNudgeSent = true;

      logger.info('Companion: generating boot greeting');

      await queue.enqueue('companion:boot', async () => {
        try {
          const message = await agentLoop(
            '[COMPANION NUDGE — BOOT GREETING] ' +
              'You just came online after being offline. Generate a short, warm "I\'m back" message ' +
              "for your owner. Reference that you're up and running. Be yourself — use your personality. " +
              'Keep it to 1-2 sentences. Do NOT use any tools. Respond ONLY with the message text.',
            'companion:nudge',
            context,
          );

          const cleaned = message
            .replace(/^["']|["']$/g, '')
            .replace(/^\[COMPANION.*?\]\s*/i, '')
            .trim();

          if (!cleaned || cleaned.length < 5) return;

          nudgeEngine.schedule({
            userId: ownerId,
            category: 'companion',
            content: cleaned,
            priority: 'normal',
            deliverAfter: 0,
            metadata: { mood: 'boot_greeting', source: 'companion' },
          });

          state.lastCompanionNudge = Date.now();
          logger.info('Companion: boot greeting scheduled', { preview: cleaned.slice(0, 60) });
        } catch (err) {
          logger.error('Companion: boot greeting failed', { error: String(err) });
        }
      });
    },
  };

  // Expose touchActivity so start.ts can wire it to user message events
  (quickCheckinJob as PulseJob & { __touchActivity?: () => void }).__touchActivity = touchActivity;

  return [quickCheckinJob, bootGreetingJob];
}

/**
 * Extract the touchActivity function from companion jobs.
 * Call this after createCompanionJobs() to get the function
 * that should be invoked on every user message.
 *
 * @param jobs - The PulseJob array returned by createCompanionJobs
 * @returns The touchActivity function, or undefined if not found
 */
export function getCompanionTouchActivity(jobs: PulseJob[]): (() => void) | undefined {
  const checkin = jobs.find((j) => j.id === 'companion-quick-checkin');
  return (checkin as PulseJob & { __touchActivity?: () => void })?.__touchActivity;
}
