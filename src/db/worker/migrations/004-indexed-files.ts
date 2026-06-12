export const version = 4;
export const description = 'Indexed files tracking for markdown folder integration';

export const up = `
CREATE TABLE IF NOT EXISTS indexed_files (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    file_path     TEXT NOT NULL UNIQUE,
    file_name     TEXT NOT NULL,
    last_modified INTEGER NOT NULL,
    content_hash  TEXT,
    node_id       TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    indexed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_indexed_files_path ON indexed_files(file_path);
CREATE INDEX IF NOT EXISTS idx_indexed_files_node ON indexed_files(node_id)
`;
