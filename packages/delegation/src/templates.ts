/**
 * Template Manager
 *
 * Manages the primary agent's collection of "job postings" — role templates
 * that improve over time based on sub-agent performance. Think of it as the
 * agent learning how to hire better freelancers through experience.
 */

import type { QueryTier } from '@tinyclaw/router';
import type { RoleTemplate } from '@tinyclaw/types';
import type { DelegationStore } from './store.js';
import type { TemplateManager } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max templates per user. */
const MAX_TEMPLATES_PER_USER = 50;

/** Minimum keyword overlap score to consider a template a match. */
const MATCH_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Keyword Matching
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'about',
  'like',
  'through',
  'after',
  'over',
  'between',
  'out',
  'up',
  'that',
  'this',
  'it',
  'and',
  'or',
  'but',
  'not',
  'no',
  'so',
  'if',
  'then',
  'than',
  'too',
  'very',
  'just',
  'also',
  'more',
  'some',
  'any',
  'each',
  'all',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function keywordScore(queryTokens: Set<string>, templateTokens: Set<string>): number {
  if (queryTokens.size === 0 || templateTokens.size === 0) return 0;
  let matches = 0;
  for (const word of queryTokens) {
    if (templateTokens.has(word)) matches++;
  }
  return matches / queryTokens.size;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createTemplateManager(db: DelegationStore): TemplateManager {
  return {
    create(config) {
      const { userId, name, roleDescription, defaultTools = [], defaultTier, tags = [] } = config;

      // Enforce max limit
      const existing = db.getRoleTemplates(userId);
      if (existing.length >= MAX_TEMPLATES_PER_USER) {
        throw new Error(
          `Maximum templates (${MAX_TEMPLATES_PER_USER}) reached. Delete unused templates first.`,
        );
      }

      const now = Date.now();
      const id = crypto.randomUUID();

      const template: RoleTemplate = {
        id,
        userId,
        name,
        roleDescription,
        defaultTools,
        defaultTier: defaultTier ?? null,
        timesUsed: 0,
        avgPerformance: 0.5,
        tags,
        createdAt: now,
        updatedAt: now,
      };

      db.saveRoleTemplate(template);
      return template;
    },

    findBestMatch(userId, taskDescription) {
      const templates = db.getRoleTemplates(userId);
      if (templates.length === 0) return null;

      const queryTokens = tokenize(taskDescription);
      if (queryTokens.size === 0) return null;

      let bestMatch: RoleTemplate | null = null;
      let bestScore = 0;

      for (const template of templates) {
        // Build combined token set from tags + role description + name
        const templateText = [template.name, template.roleDescription, ...template.tags].join(' ');
        const templateTokens = tokenize(templateText);

        const score = keywordScore(queryTokens, templateTokens);
        if (score > bestScore && score >= MATCH_THRESHOLD) {
          bestScore = score;
          bestMatch = template;
        }
      }

      return bestMatch;
    },

    update(templateId, updates) {
      const template = db.getRoleTemplate(templateId);
      if (!template) return null;

      const dbUpdates: Record<string, unknown> = { updatedAt: Date.now() };

      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.roleDescription !== undefined)
        dbUpdates.roleDescription = updates.roleDescription;
      if (updates.defaultTools !== undefined) dbUpdates.defaultTools = updates.defaultTools;
      if (updates.defaultTier !== undefined) dbUpdates.defaultTier = updates.defaultTier;
      if (updates.tags !== undefined) dbUpdates.tags = updates.tags;

      db.updateRoleTemplate(templateId, dbUpdates as Partial<RoleTemplate>);

      return db.getRoleTemplate(templateId);
    },

    recordUsage(templateId, performanceScore) {
      const template = db.getRoleTemplate(templateId);
      if (!template) return;

      const timesUsed = template.timesUsed + 1;
      // Running average: (old_avg * old_count + new_score) / new_count
      const avgPerformance =
        (template.avgPerformance * template.timesUsed + performanceScore) / timesUsed;

      db.updateRoleTemplate(templateId, {
        timesUsed,
        avgPerformance,
        updatedAt: Date.now(),
      });
    },

    list(userId) {
      return db.getRoleTemplates(userId);
    },

    delete(templateId) {
      db.deleteRoleTemplate(templateId);
    },
  };
}
