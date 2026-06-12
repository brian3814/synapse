export const version = 7;
export const description = 'Reading list history for merged pages';

export const up = `
CREATE TABLE IF NOT EXISTS reading_list_history (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  url              TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  key_topics       TEXT NOT NULL DEFAULT '[]',
  merged_at        TEXT NOT NULL DEFAULT (datetime('now')),
  node_ids         TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rlh_merged ON reading_list_history(merged_at DESC)
`;
