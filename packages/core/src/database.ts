import { Database as BunDatabase, type SQLQueryBindings } from 'bun:sqlite';
import type {
  BackgroundTask,
  BlackboardEntry,
  CompactionRecord,
  Database,
  EpisodicRecord,
  Message,
  QueryTier,
  RoleTemplate,
  SubAgentRecord,
  TaskMetricRecord,
} from '@tinyclaw/types';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export function createDatabase(path: string): Database {
  // Ensure directory exists
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (err) {
    // Directory might already exist
  }

  const db = new BunDatabase(path);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_user_created ON messages(user_id, created_at);
    
    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, key)
    );

    CREATE TABLE IF NOT EXISTS compactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      replaced_before INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_compactions_user ON compactions(user_id, created_at);

    CREATE TABLE IF NOT EXISTS sub_agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      tools_granted TEXT NOT NULL DEFAULT '[]',
      tier_preference TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      performance_score REAL NOT NULL DEFAULT 0.5,
      total_tasks INTEGER NOT NULL DEFAULT 0,
      successful_tasks INTEGER NOT NULL DEFAULT 0,
      template_id TEXT,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sub_agents_user ON sub_agents(user_id, status);

    CREATE TABLE IF NOT EXISTS role_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role_description TEXT NOT NULL,
      default_tools TEXT NOT NULL DEFAULT '[]',
      default_tier TEXT,
      times_used INTEGER NOT NULL DEFAULT 0,
      avg_performance REAL NOT NULL DEFAULT 0.5,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_role_templates_user ON role_templates(user_id);

    CREATE TABLE IF NOT EXISTS background_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      result TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      delivered_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bg_tasks_user ON background_tasks(user_id, status);

    -- Episodic Memory (v3) — timestamped events with outcomes
    CREATE TABLE IF NOT EXISTS episodic_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      content TEXT NOT NULL,
      outcome TEXT,
      importance REAL NOT NULL DEFAULT 0.5,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_user ON episodic_memory(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(user_id, importance DESC);

    -- Task execution metrics (v3) — for adaptive timeouts + analytics
    CREATE TABLE IF NOT EXISTS task_metrics (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      tier TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      iterations INTEGER NOT NULL,
      success INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_metrics_type ON task_metrics(task_type, created_at);

    -- Blackboard (v3) — collaborative problem-solving between sub-agents
    CREATE TABLE IF NOT EXISTS blackboard (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      problem_text TEXT,
      agent_id TEXT,
      agent_role TEXT,
      proposal TEXT,
      confidence REAL DEFAULT 0.0,
      synthesis TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blackboard_problem ON blackboard(problem_id, status);
    CREATE INDEX IF NOT EXISTS idx_blackboard_user ON blackboard(user_id, status);
  `);

  // FTS5 virtual table for semantic search over episodic memory
  // Use try/catch because FTS5 table can't use IF NOT EXISTS in all SQLite versions
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        content,
        tags,
        tokenize='porter unicode61'
      );
    `);
  } catch {
    // Table already exists — safe to ignore
  }

  const saveMessageStmt = db.prepare(`
    INSERT INTO messages (user_id, role, content, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const getHistoryStmt = db.prepare(`
    SELECT role, content FROM messages
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const saveMemoryStmt = db.prepare(`
    INSERT INTO memory (user_id, key, value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  const getMemoryStmt = db.prepare(`
    SELECT key, value FROM memory
    WHERE user_id = ?
  `);

  const getMessageCountStmt = db.prepare(`
    SELECT COUNT(*) as count FROM messages
    WHERE user_id = ?
  `);

  const getMessageTimestampsStmt = db.prepare(`
    SELECT created_at FROM messages
    WHERE user_id = ?
    ORDER BY created_at ASC
  `);

  const saveCompactionStmt = db.prepare(`
    INSERT INTO compactions (user_id, summary, replaced_before, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const getLatestCompactionStmt = db.prepare(`
    SELECT id, user_id, summary, replaced_before, created_at
    FROM compactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const deleteMessagesBeforeStmt = db.prepare(`
    DELETE FROM messages
    WHERE user_id = ? AND created_at < ?
  `);

  const deleteMessagesForUserStmt = db.prepare(`
    DELETE FROM messages WHERE user_id = ?
  `);

  // --- Sub-agent prepared statements ---

  const saveSubAgentStmt = db.prepare(`
    INSERT INTO sub_agents (id, user_id, role, system_prompt, tools_granted,
      tier_preference, status, performance_score, total_tasks, successful_tasks,
      template_id, created_at, last_active_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getSubAgentStmt = db.prepare(`
    SELECT * FROM sub_agents WHERE id = ?
  `);

  const getActiveSubAgentsStmt = db.prepare(`
    SELECT * FROM sub_agents WHERE user_id = ? AND status IN ('active', 'suspended')
    ORDER BY last_active_at DESC
  `);

  const getAllSubAgentsStmt = db.prepare(`
    SELECT * FROM sub_agents WHERE user_id = ?
    ORDER BY last_active_at DESC
  `);

  const getAllSubAgentsExclDeletedStmt = db.prepare(`
    SELECT * FROM sub_agents WHERE user_id = ? AND status != 'soft_deleted'
    ORDER BY last_active_at DESC
  `);

  const deleteExpiredSubAgentsStmt = db.prepare(`
    DELETE FROM sub_agents WHERE status = 'soft_deleted' AND deleted_at < ?
  `);

  const archiveStaleSuspendedStmt = db.prepare(`
    UPDATE sub_agents SET status = 'soft_deleted', deleted_at = ?
    WHERE status = 'suspended' AND last_active_at < ?
  `);

  // --- Role template prepared statements ---

  const saveRoleTemplateStmt = db.prepare(`
    INSERT INTO role_templates (id, user_id, name, role_description, default_tools,
      default_tier, times_used, avg_performance, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getRoleTemplateStmt = db.prepare(`
    SELECT * FROM role_templates WHERE id = ?
  `);

  const getRoleTemplatesStmt = db.prepare(`
    SELECT * FROM role_templates WHERE user_id = ?
    ORDER BY times_used DESC, updated_at DESC
  `);

  const deleteRoleTemplateStmt = db.prepare(`
    DELETE FROM role_templates WHERE id = ?
  `);

  // --- Background task prepared statements ---

  const saveBackgroundTaskStmt = db.prepare(`
    INSERT INTO background_tasks (id, user_id, agent_id, task_description,
      status, result, started_at, completed_at, delivered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getBackgroundTaskStmt = db.prepare(`
    SELECT * FROM background_tasks WHERE id = ?
  `);

  const getUndeliveredTasksStmt = db.prepare(`
    SELECT * FROM background_tasks
    WHERE user_id = ? AND status IN ('completed', 'failed') AND delivered_at IS NULL
    ORDER BY completed_at ASC
  `);

  const updateBackgroundTaskStmt = db.prepare(`
    UPDATE background_tasks SET status = ?, result = ?, completed_at = ?
    WHERE id = ?
  `);

  const markTaskDeliveredStmt = db.prepare(`
    UPDATE background_tasks SET status = 'delivered', delivered_at = ?
    WHERE id = ?
  `);

  const getStaleBackgroundTasksStmt = db.prepare(`
    SELECT * FROM background_tasks
    WHERE status = 'running' AND started_at < ?
  `);

  const getUserBackgroundTasksStmt = db.prepare(`
    SELECT * FROM background_tasks
    WHERE user_id = ? AND status IN ('running', 'completed', 'failed')
    ORDER BY started_at DESC
  `);

  // --- Episodic memory prepared statements ---

  const saveEpisodicEventStmt = db.prepare(`
    INSERT INTO episodic_memory (id, user_id, event_type, content, outcome,
      importance, access_count, created_at, last_accessed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getEpisodicEventStmt = db.prepare(`
    SELECT * FROM episodic_memory WHERE id = ?
  `);

  const getEpisodicEventsStmt = db.prepare(`
    SELECT * FROM episodic_memory WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const updateEpisodicAccessStmt = db.prepare(`
    UPDATE episodic_memory SET access_count = access_count + 1, last_accessed_at = ?
    WHERE id = ?
  `);

  const pruneEpisodicEventsStmt = db.prepare(`
    DELETE FROM episodic_memory
    WHERE user_id = ? AND importance < ? AND access_count <= ? AND created_at < ?
  `);

  // --- FTS5 prepared statements ---

  const insertFTSStmt = db.prepare(`
    INSERT INTO memory_fts (id, content, tags) VALUES (?, ?, ?)
  `);

  const deleteFTSStmt = db.prepare(`
    DELETE FROM memory_fts WHERE id = ?
  `);

  // --- Task metrics prepared statements ---

  const saveTaskMetricStmt = db.prepare(`
    INSERT INTO task_metrics (id, user_id, task_type, tier, duration_ms,
      iterations, success, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getTaskMetricsStmt = db.prepare(`
    SELECT * FROM task_metrics
    WHERE task_type = ? AND tier = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  // --- Blackboard prepared statements ---

  const saveBlackboardEntryStmt = db.prepare(`
    INSERT INTO blackboard (id, user_id, problem_id, problem_text, agent_id,
      agent_role, proposal, confidence, synthesis, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getBlackboardEntryStmt = db.prepare(`
    SELECT * FROM blackboard WHERE id = ?
  `);

  const getBlackboardProposalsStmt = db.prepare(`
    SELECT * FROM blackboard
    WHERE problem_id = ? AND agent_id IS NOT NULL
    ORDER BY confidence DESC
  `);

  const getActiveProblemsStmt = db.prepare(`
    SELECT * FROM blackboard
    WHERE user_id = ? AND status = 'open' AND problem_text IS NOT NULL
    ORDER BY created_at DESC
  `);

  const resolveBlackboardProblemStmt = db.prepare(`
    UPDATE blackboard SET status = 'resolved', synthesis = ?
    WHERE problem_id = ?
  `);

  // --- Helper: parse sub-agent row ---

  function parseSubAgentRow(row: Record<string, unknown>): SubAgentRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      role: row.role as string,
      systemPrompt: row.system_prompt as string,
      toolsGranted: JSON.parse((row.tools_granted as string) || '[]'),
      tierPreference: (row.tier_preference as QueryTier) || null,
      status: row.status as SubAgentRecord['status'],
      performanceScore: row.performance_score as number,
      totalTasks: row.total_tasks as number,
      successfulTasks: row.successful_tasks as number,
      templateId: (row.template_id as string) || null,
      createdAt: row.created_at as number,
      lastActiveAt: row.last_active_at as number,
      deletedAt: (row.deleted_at as number) || null,
    };
  }

  function parseRoleTemplateRow(row: Record<string, unknown>): RoleTemplate {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      name: row.name as string,
      roleDescription: row.role_description as string,
      defaultTools: JSON.parse((row.default_tools as string) || '[]'),
      defaultTier: (row.default_tier as QueryTier) || null,
      timesUsed: row.times_used as number,
      avgPerformance: row.avg_performance as number,
      tags: JSON.parse((row.tags as string) || '[]'),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  function parseEpisodicRow(row: Record<string, unknown>): EpisodicRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      eventType: row.event_type as EpisodicRecord['eventType'],
      content: row.content as string,
      outcome: (row.outcome as string) || null,
      importance: row.importance as number,
      accessCount: row.access_count as number,
      createdAt: row.created_at as number,
      lastAccessedAt: row.last_accessed_at as number,
    };
  }

  function parseBlackboardRow(row: Record<string, unknown>): BlackboardEntry {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      problemId: row.problem_id as string,
      problemText: (row.problem_text as string) || null,
      agentId: (row.agent_id as string) || null,
      agentRole: (row.agent_role as string) || null,
      proposal: (row.proposal as string) || null,
      confidence: (row.confidence as number) || 0,
      synthesis: (row.synthesis as string) || null,
      status: row.status as BlackboardEntry['status'],
      createdAt: row.created_at as number,
    };
  }

  function parseTaskMetricRow(row: Record<string, unknown>): TaskMetricRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      taskType: row.task_type as string,
      tier: row.tier as string,
      durationMs: row.duration_ms as number,
      iterations: row.iterations as number,
      success: (row.success as number) === 1,
      createdAt: row.created_at as number,
    };
  }

  function parseBackgroundTaskRow(row: Record<string, unknown>): BackgroundTask {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      agentId: row.agent_id as string,
      taskDescription: row.task_description as string,
      status: row.status as BackgroundTask['status'],
      result: (row.result as string) || null,
      startedAt: row.started_at as number,
      completedAt: (row.completed_at as number) || null,
      deliveredAt: (row.delivered_at as number) || null,
    };
  }

  return {
    saveMessage(userId: string, role: string, content: string): void {
      saveMessageStmt.run(userId, role, content, Date.now());
    },

    getHistory(userId: string, limit: number = 50): Message[] {
      const rows = getHistoryStmt.all(userId, limit) as Array<{ role: string; content: string }>;
      return rows.reverse().map((row) => ({
        role: row.role as Message['role'],
        content: row.content,
      }));
    },

    getMessageCount(userId: string): number {
      const row = getMessageCountStmt.get(userId) as { count: number } | null;
      return row?.count ?? 0;
    },

    getMessageTimestamps(userId: string): number[] {
      const rows = getMessageTimestampsStmt.all(userId) as Array<{ created_at: number }>;
      return rows.map((r) => r.created_at);
    },

    saveCompaction(userId: string, summary: string, replacedBefore: number): void {
      saveCompactionStmt.run(userId, summary, replacedBefore, Date.now());
    },

    getLatestCompaction(userId: string): CompactionRecord | null {
      const row = getLatestCompactionStmt.get(userId) as {
        id: number;
        user_id: string;
        summary: string;
        replaced_before: number;
        created_at: number;
      } | null;

      if (!row) return null;

      return {
        id: row.id,
        userId: row.user_id,
        summary: row.summary,
        replacedBefore: row.replaced_before,
        createdAt: row.created_at,
      };
    },

    deleteMessagesBefore(userId: string, beforeTimestamp: number): void {
      deleteMessagesBeforeStmt.run(userId, beforeTimestamp);
    },

    deleteMessagesForUser(userId: string): void {
      deleteMessagesForUserStmt.run(userId);
    },

    saveMemory(userId: string, key: string, value: string): void {
      const now = Date.now();
      saveMemoryStmt.run(userId, key, value, now, now);
    },

    getMemory(userId: string): Record<string, string> {
      const rows = getMemoryStmt.all(userId) as Array<{ key: string; value: string }>;
      const memory: Record<string, string> = {};
      for (const row of rows) {
        memory[row.key] = row.value;
      }
      return memory;
    },

    // --- Sub-agents ---

    saveSubAgent(record: SubAgentRecord): void {
      saveSubAgentStmt.run(
        record.id,
        record.userId,
        record.role,
        record.systemPrompt,
        JSON.stringify(record.toolsGranted),
        record.tierPreference,
        record.status,
        record.performanceScore,
        record.totalTasks,
        record.successfulTasks,
        record.templateId,
        record.createdAt,
        record.lastActiveAt,
        record.deletedAt,
      );
    },

    getSubAgent(id: string): SubAgentRecord | null {
      const row = getSubAgentStmt.get(id) as Record<string, unknown> | null;
      return row ? parseSubAgentRow(row) : null;
    },

    getActiveSubAgents(userId: string): SubAgentRecord[] {
      const rows = getActiveSubAgentsStmt.all(userId) as Record<string, unknown>[];
      return rows.map(parseSubAgentRow);
    },

    getAllSubAgents(userId: string, includeDeleted = false): SubAgentRecord[] {
      const stmt = includeDeleted ? getAllSubAgentsStmt : getAllSubAgentsExclDeletedStmt;
      const rows = stmt.all(userId) as Record<string, unknown>[];
      return rows.map(parseSubAgentRow);
    },

    updateSubAgent(id: string, updates: Partial<SubAgentRecord>): void {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (updates.status !== undefined) {
        fields.push('status = ?');
        values.push(updates.status);
      }
      if (updates.performanceScore !== undefined) {
        fields.push('performance_score = ?');
        values.push(updates.performanceScore);
      }
      if (updates.totalTasks !== undefined) {
        fields.push('total_tasks = ?');
        values.push(updates.totalTasks);
      }
      if (updates.successfulTasks !== undefined) {
        fields.push('successful_tasks = ?');
        values.push(updates.successfulTasks);
      }
      if (updates.lastActiveAt !== undefined) {
        fields.push('last_active_at = ?');
        values.push(updates.lastActiveAt);
      }
      if (updates.deletedAt !== undefined) {
        fields.push('deleted_at = ?');
        values.push(updates.deletedAt);
      }
      if ('deletedAt' in updates && updates.deletedAt === null) {
        fields.push('deleted_at = NULL');
      }

      if (fields.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE sub_agents SET ${fields.join(', ')} WHERE id = ?`).run(
        ...(values as SQLQueryBindings[]),
      );
    },

    deleteExpiredSubAgents(beforeTimestamp: number): number {
      const result = deleteExpiredSubAgentsStmt.run(beforeTimestamp);
      return result.changes;
    },

    archiveStaleSuspended(inactiveBefore: number): number {
      const result = archiveStaleSuspendedStmt.run(Date.now(), inactiveBefore);
      return result.changes;
    },

    // --- Role templates ---

    saveRoleTemplate(template: RoleTemplate): void {
      saveRoleTemplateStmt.run(
        template.id,
        template.userId,
        template.name,
        template.roleDescription,
        JSON.stringify(template.defaultTools),
        template.defaultTier,
        template.timesUsed,
        template.avgPerformance,
        JSON.stringify(template.tags),
        template.createdAt,
        template.updatedAt,
      );
    },

    getRoleTemplate(id: string): RoleTemplate | null {
      const row = getRoleTemplateStmt.get(id) as Record<string, unknown> | null;
      return row ? parseRoleTemplateRow(row) : null;
    },

    getRoleTemplates(userId: string): RoleTemplate[] {
      const rows = getRoleTemplatesStmt.all(userId) as Record<string, unknown>[];
      return rows.map(parseRoleTemplateRow);
    },

    updateRoleTemplate(id: string, updates: Partial<RoleTemplate>): void {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (updates.name !== undefined) {
        fields.push('name = ?');
        values.push(updates.name);
      }
      if (updates.roleDescription !== undefined) {
        fields.push('role_description = ?');
        values.push(updates.roleDescription);
      }
      if (updates.defaultTools !== undefined) {
        fields.push('default_tools = ?');
        values.push(JSON.stringify(updates.defaultTools));
      }
      if (updates.defaultTier !== undefined) {
        fields.push('default_tier = ?');
        values.push(updates.defaultTier);
      }
      if (updates.timesUsed !== undefined) {
        fields.push('times_used = ?');
        values.push(updates.timesUsed);
      }
      if (updates.avgPerformance !== undefined) {
        fields.push('avg_performance = ?');
        values.push(updates.avgPerformance);
      }
      if (updates.tags !== undefined) {
        fields.push('tags = ?');
        values.push(JSON.stringify(updates.tags));
      }
      if (updates.updatedAt !== undefined) {
        fields.push('updated_at = ?');
        values.push(updates.updatedAt);
      }

      if (fields.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE role_templates SET ${fields.join(', ')} WHERE id = ?`).run(
        ...(values as SQLQueryBindings[]),
      );
    },

    deleteRoleTemplate(id: string): void {
      deleteRoleTemplateStmt.run(id);
    },

    // --- Background tasks ---

    saveBackgroundTask(record: BackgroundTask): void {
      saveBackgroundTaskStmt.run(
        record.id,
        record.userId,
        record.agentId,
        record.taskDescription,
        record.status,
        record.result,
        record.startedAt,
        record.completedAt,
        record.deliveredAt,
      );
    },

    updateBackgroundTask(
      id: string,
      status: string,
      result: string | null,
      completedAt: number | null,
    ): void {
      updateBackgroundTaskStmt.run(status, result, completedAt, id);
    },

    getUndeliveredTasks(userId: string): BackgroundTask[] {
      const rows = getUndeliveredTasksStmt.all(userId) as Record<string, unknown>[];
      return rows.map(parseBackgroundTaskRow);
    },

    getBackgroundTask(id: string): BackgroundTask | null {
      const row = getBackgroundTaskStmt.get(id) as Record<string, unknown> | null;
      return row ? parseBackgroundTaskRow(row) : null;
    },

    getUserBackgroundTasks(userId: string): BackgroundTask[] {
      const rows = getUserBackgroundTasksStmt.all(userId) as Record<string, unknown>[];
      return rows.map(parseBackgroundTaskRow);
    },

    markTaskDelivered(id: string): void {
      markTaskDeliveredStmt.run(Date.now(), id);
    },

    getStaleBackgroundTasks(olderThanMs: number): BackgroundTask[] {
      const cutoff = Date.now() - olderThanMs;
      const rows = getStaleBackgroundTasksStmt.all(cutoff) as Record<string, unknown>[];
      return rows.map(parseBackgroundTaskRow);
    },

    // --- Episodic memory ---

    saveEpisodicEvent(record: EpisodicRecord): void {
      saveEpisodicEventStmt.run(
        record.id,
        record.userId,
        record.eventType,
        record.content,
        record.outcome,
        record.importance,
        record.accessCount,
        record.createdAt,
        record.lastAccessedAt,
      );
      // Also index in FTS5 for full-text search
      const tags = `${record.eventType} ${record.userId}`;
      insertFTSStmt.run(
        record.id,
        record.content + (record.outcome ? ' ' + record.outcome : ''),
        tags,
      );
    },

    getEpisodicEvent(id: string): EpisodicRecord | null {
      const row = getEpisodicEventStmt.get(id) as Record<string, unknown> | null;
      return row ? parseEpisodicRow(row) : null;
    },

    getEpisodicEvents(userId: string, limit = 50): EpisodicRecord[] {
      const rows = getEpisodicEventsStmt.all(userId, limit) as Record<string, unknown>[];
      return rows.map(parseEpisodicRow);
    },

    updateEpisodicEvent(id: string, updates: Partial<EpisodicRecord>): void {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (updates.importance !== undefined) {
        fields.push('importance = ?');
        values.push(updates.importance);
      }
      if (updates.accessCount !== undefined) {
        fields.push('access_count = ?');
        values.push(updates.accessCount);
      }
      if (updates.lastAccessedAt !== undefined) {
        fields.push('last_accessed_at = ?');
        values.push(updates.lastAccessedAt);
      }
      if (updates.content !== undefined) {
        fields.push('content = ?');
        values.push(updates.content);
      }
      if (updates.outcome !== undefined) {
        fields.push('outcome = ?');
        values.push(updates.outcome);
      }

      if (fields.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE episodic_memory SET ${fields.join(', ')} WHERE id = ?`).run(
        ...(values as SQLQueryBindings[]),
      );
    },

    deleteEpisodicEvents(ids: string[]): void {
      if (ids.length === 0) return;
      const placeholders = ids.map(() => '?').join(', ');
      db.prepare(`DELETE FROM episodic_memory WHERE id IN (${placeholders})`).run(...ids);
      // Also remove from FTS5 index
      for (const id of ids) {
        deleteFTSStmt.run(id);
      }
    },

    searchEpisodicFTS(
      query: string,
      userId: string,
      limit = 20,
    ): Array<{ id: string; rank: number }> {
      if (!query.trim()) return [];
      try {
        const rows = db
          .prepare(`
          SELECT f.id, rank
          FROM memory_fts f
          JOIN episodic_memory e ON e.id = f.id
          WHERE memory_fts MATCH ?
            AND e.user_id = ?
          ORDER BY rank
          LIMIT ?
        `)
          .all(query, userId, limit) as Array<{ id: string; rank: number }>;
        return rows;
      } catch {
        // FTS5 match can fail on malformed queries — graceful fallback
        return [];
      }
    },

    decayEpisodicImportance(userId: string, olderThanDays: number, decayFactor: number): number {
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
      const result = db
        .prepare(`
        UPDATE episodic_memory
        SET importance = importance * ?
        WHERE user_id = ? AND last_accessed_at < ? AND importance > 0.05
      `)
        .run(decayFactor, userId, cutoff);
      return result.changes;
    },

    pruneEpisodicEvents(
      userId: string,
      maxImportance: number,
      maxAccessCount: number,
      olderThanMs: number,
    ): number {
      const cutoff = Date.now() - olderThanMs;
      // First get IDs to prune (so we can clean FTS too)
      const rows = db
        .prepare(`
        SELECT id FROM episodic_memory
        WHERE user_id = ? AND importance < ? AND access_count <= ? AND created_at < ?
      `)
        .all(userId, maxImportance, maxAccessCount, cutoff) as Array<{ id: string }>;

      if (rows.length === 0) return 0;

      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(', ');
      db.prepare(`DELETE FROM episodic_memory WHERE id IN (${placeholders})`).run(...ids);
      for (const id of ids) {
        deleteFTSStmt.run(id);
      }
      return ids.length;
    },

    // --- Task metrics ---

    saveTaskMetric(record: TaskMetricRecord): void {
      saveTaskMetricStmt.run(
        record.id,
        record.userId,
        record.taskType,
        record.tier,
        record.durationMs,
        record.iterations,
        record.success ? 1 : 0,
        record.createdAt,
      );
    },

    getTaskMetrics(taskType: string, tier: string, limit = 30): TaskMetricRecord[] {
      const rows = getTaskMetricsStmt.all(taskType, tier, limit) as Record<string, unknown>[];
      return rows.map(parseTaskMetricRow);
    },

    // --- Blackboard ---

    saveBlackboardEntry(entry: BlackboardEntry): void {
      saveBlackboardEntryStmt.run(
        entry.id,
        entry.userId,
        entry.problemId,
        entry.problemText,
        entry.agentId,
        entry.agentRole,
        entry.proposal,
        entry.confidence,
        entry.synthesis,
        entry.status,
        entry.createdAt,
      );
    },

    getBlackboardEntry(id: string): BlackboardEntry | null {
      const row = getBlackboardEntryStmt.get(id) as Record<string, unknown> | null;
      return row ? parseBlackboardRow(row) : null;
    },

    getBlackboardProposals(problemId: string): BlackboardEntry[] {
      const rows = getBlackboardProposalsStmt.all(problemId) as Record<string, unknown>[];
      return rows.map(parseBlackboardRow);
    },

    getActiveProblems(userId: string): BlackboardEntry[] {
      const rows = getActiveProblemsStmt.all(userId) as Record<string, unknown>[];
      return rows.map(parseBlackboardRow);
    },

    resolveBlackboardProblem(problemId: string, synthesis: string): void {
      resolveBlackboardProblemStmt.run(synthesis, problemId);
    },

    cleanupBlackboard(olderThanMs: number): number {
      const cutoff = Date.now() - olderThanMs;
      const result = db
        .prepare(`
        DELETE FROM blackboard WHERE status = 'resolved' AND created_at < ?
      `)
        .run(cutoff);
      return result.changes;
    },

    close(): void {
      db.close();
    },
  };
}
