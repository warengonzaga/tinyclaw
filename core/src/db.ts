import { Database as BunDatabase } from 'bun:sqlite';
import { Database, Message, CompactionRecord, SubAgentRecord, RoleTemplate, BackgroundTask } from './types.js';
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
  `);
  
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
    SELECT * FROM sub_agents WHERE user_id = ? AND status = 'active'
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

  // --- Helper: parse sub-agent row ---

  function parseSubAgentRow(row: Record<string, unknown>): SubAgentRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      role: row.role as string,
      systemPrompt: row.system_prompt as string,
      toolsGranted: JSON.parse((row.tools_granted as string) || '[]'),
      tierPreference: (row.tier_preference as string) || null,
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
      defaultTier: (row.default_tier as string) || null,
      timesUsed: row.times_used as number,
      avgPerformance: row.avg_performance as number,
      tags: JSON.parse((row.tags as string) || '[]'),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
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
      const rows = getHistoryStmt.all(userId, limit) as Array<{role: string, content: string}>;
      return rows.reverse().map(row => ({
        role: row.role as Message['role'],
        content: row.content
      }));
    },

    getMessageCount(userId: string): number {
      const row = getMessageCountStmt.get(userId) as { count: number } | null;
      return row?.count ?? 0;
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
      const rows = getMemoryStmt.all(userId) as Array<{key: string, value: string}>;
      const memory: Record<string, string> = {};
      for (const row of rows) {
        memory[row.key] = row.value;
      }
      return memory;
    },
    
    // --- Sub-agents ---

    saveSubAgent(record: SubAgentRecord): void {
      saveSubAgentStmt.run(
        record.id, record.userId, record.role, record.systemPrompt,
        JSON.stringify(record.toolsGranted), record.tierPreference,
        record.status, record.performanceScore, record.totalTasks,
        record.successfulTasks, record.templateId,
        record.createdAt, record.lastActiveAt, record.deletedAt,
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

      if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
      if (updates.performanceScore !== undefined) { fields.push('performance_score = ?'); values.push(updates.performanceScore); }
      if (updates.totalTasks !== undefined) { fields.push('total_tasks = ?'); values.push(updates.totalTasks); }
      if (updates.successfulTasks !== undefined) { fields.push('successful_tasks = ?'); values.push(updates.successfulTasks); }
      if (updates.lastActiveAt !== undefined) { fields.push('last_active_at = ?'); values.push(updates.lastActiveAt); }
      if (updates.deletedAt !== undefined) { fields.push('deleted_at = ?'); values.push(updates.deletedAt); }
      if ('deletedAt' in updates && updates.deletedAt === null) { fields.push('deleted_at = NULL'); }

      if (fields.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE sub_agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    },

    deleteExpiredSubAgents(beforeTimestamp: number): number {
      const result = deleteExpiredSubAgentsStmt.run(beforeTimestamp);
      return result.changes;
    },

    // --- Role templates ---

    saveRoleTemplate(template: RoleTemplate): void {
      saveRoleTemplateStmt.run(
        template.id, template.userId, template.name, template.roleDescription,
        JSON.stringify(template.defaultTools), template.defaultTier,
        template.timesUsed, template.avgPerformance,
        JSON.stringify(template.tags), template.createdAt, template.updatedAt,
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

      if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
      if (updates.roleDescription !== undefined) { fields.push('role_description = ?'); values.push(updates.roleDescription); }
      if (updates.defaultTools !== undefined) { fields.push('default_tools = ?'); values.push(JSON.stringify(updates.defaultTools)); }
      if (updates.defaultTier !== undefined) { fields.push('default_tier = ?'); values.push(updates.defaultTier); }
      if (updates.timesUsed !== undefined) { fields.push('times_used = ?'); values.push(updates.timesUsed); }
      if (updates.avgPerformance !== undefined) { fields.push('avg_performance = ?'); values.push(updates.avgPerformance); }
      if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
      if (updates.updatedAt !== undefined) { fields.push('updated_at = ?'); values.push(updates.updatedAt); }

      if (fields.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE role_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    },

    deleteRoleTemplate(id: string): void {
      deleteRoleTemplateStmt.run(id);
    },

    // --- Background tasks ---

    saveBackgroundTask(record: BackgroundTask): void {
      saveBackgroundTaskStmt.run(
        record.id, record.userId, record.agentId, record.taskDescription,
        record.status, record.result, record.startedAt,
        record.completedAt, record.deliveredAt,
      );
    },

    updateBackgroundTask(id: string, status: string, result: string | null, completedAt: number | null): void {
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

    markTaskDelivered(id: string): void {
      markTaskDeliveredStmt.run(Date.now(), id);
    },

    getStaleBackgroundTasks(olderThanMs: number): BackgroundTask[] {
      const cutoff = Date.now() - olderThanMs;
      const rows = getStaleBackgroundTasksStmt.all(cutoff) as Record<string, unknown>[];
      return rows.map(parseBackgroundTaskRow);
    },

    close(): void {
      db.close();
    }
  };
}
