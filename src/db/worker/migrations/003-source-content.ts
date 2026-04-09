export const version = 3;
export const description = 'Source content storage for extracted pages';

export const up = `
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
CREATE INDEX IF NOT EXISTS idx_source_content_node ON source_content(node_id);
CREATE INDEX IF NOT EXISTS idx_source_content_url ON source_content(url);
CREATE INDEX IF NOT EXISTS idx_source_content_hash ON source_content(content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_content_url_time ON source_content(url, extracted_at)
`;
