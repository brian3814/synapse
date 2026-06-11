export const version = 14;
export const description =
  'Schema cleanup: drop dead tables/columns; repair vaults initialized by the old synapse-mcp CLI';

// Three vault flavors must survive this migration:
//   1. healthy app vaults at v13,
//   2. vaults initialized by the old synapse-mcp INIT_SCHEMA (stamped v11:
//      missing source_content/reading_list_history/FTS, wrong-shaped
//      embedding tables, extra spatial_positions/reading_list/browsing_history),
//   3. fresh databases (001..013 just ran).
// Hence: DROP TABLE IF EXISTS for tables, repair-create-then-rebuild for
// tables that may be absent, and plain DROP COLUMN only for columns present
// in BOTH the v13 schema and the old MCP copy.
// chat_sessions is intentionally NOT rebuilt here (chat_messages cascades on
// it); its dead preset_id column is dropped by the runner's ensure-block.
export const up = `
DROP TABLE IF EXISTS extraction_log;
DROP TABLE IF EXISTS note_folders;
DROP TABLE IF EXISTS indexed_files;
DROP TABLE IF EXISTS memory_semantic;
DROP TABLE IF EXISTS memory_episodic;
DROP TABLE IF EXISTS embedding_dismissals;
DROP TABLE IF EXISTS spatial_positions;
DROP TABLE IF EXISTS reading_list;
DROP TABLE IF EXISTS browsing_history;

CREATE TABLE IF NOT EXISTS source_content (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    url         TEXT NOT NULL,
    title       TEXT,
    content     TEXT NOT NULL,
    content_hash TEXT,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE source_content_new (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    url         TEXT NOT NULL,
    title       TEXT,
    content     TEXT NOT NULL,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO source_content_new (id, node_id, url, title, content, extracted_at)
    SELECT id, node_id, url, title, content, extracted_at FROM source_content;
DROP TABLE source_content;
ALTER TABLE source_content_new RENAME TO source_content;
CREATE INDEX IF NOT EXISTS idx_source_content_node ON source_content(node_id);
CREATE INDEX IF NOT EXISTS idx_source_content_url ON source_content(url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_content_url_time ON source_content(url, extracted_at);

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
CREATE TABLE reading_list_history_new (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  url              TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  key_topics       TEXT NOT NULL DEFAULT '[]',
  merged_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO reading_list_history_new (id, url, title, summary, key_topics, merged_at)
    SELECT id, url, title, summary, key_topics, merged_at FROM reading_list_history;
DROP TABLE reading_list_history;
ALTER TABLE reading_list_history_new RENAME TO reading_list_history;
CREATE INDEX IF NOT EXISTS idx_rlh_merged ON reading_list_history(merged_at DESC);

CREATE TABLE ontology_node_types_new (
    type              TEXT PRIMARY KEY,
    description       TEXT,
    color             TEXT,
    category          TEXT NOT NULL DEFAULT 'entity_label'
);
INSERT INTO ontology_node_types_new (type, description, color, category)
    SELECT type, description, color, category FROM ontology_node_types;
DROP TABLE ontology_node_types;
ALTER TABLE ontology_node_types_new RENAME TO ontology_node_types;

ALTER TABLE ontology_edge_types DROP COLUMN source_types;
ALTER TABLE ontology_edge_types DROP COLUMN target_types;
ALTER TABLE ontology_edge_types DROP COLUMN properties_schema;

ALTER TABLE chat_messages DROP COLUMN rag_context;
ALTER TABLE note_attachments DROP COLUMN source_url;
ALTER TABLE edges DROP COLUMN source_url;
ALTER TABLE nodes DROP COLUMN z;
ALTER TABLE nodes DROP COLUMN content_type;
DROP INDEX IF EXISTS idx_nodes_folder_path;
ALTER TABLE nodes DROP COLUMN folder_path;

DROP TABLE IF EXISTS embedding_metadata;
CREATE TABLE embedding_metadata (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  text_hash TEXT NOT NULL
);
`;
