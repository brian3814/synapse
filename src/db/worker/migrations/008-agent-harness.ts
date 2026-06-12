export const version = 8;
export const description = 'Agent harness: memory tables and chat session preset column';

export const up = `
CREATE TABLE IF NOT EXISTS memory_semantic (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  source_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_semantic_category ON memory_semantic(category);

CREATE TABLE IF NOT EXISTS memory_episodic (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_topics TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_episodic_session ON memory_episodic(session_id);
`;
