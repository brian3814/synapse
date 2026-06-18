export const SCHEMA_VERSION = 14;

export const coreDDL = `
CREATE TABLE IF NOT EXISTS nodes (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    identifier   TEXT UNIQUE,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL DEFAULT 'entity',
    label        TEXT,
    summary      TEXT,
    properties   TEXT NOT NULL DEFAULT '{}',
    x            REAL,
    y            REAL,
    color        TEXT,
    size         REAL DEFAULT 1.0,
    source_url   TEXT,
    vault_path   TEXT,
    file_mtime   INTEGER,
    file_size    INTEGER,
    content_hash TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_identifier ON nodes(identifier);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_note_name ON nodes(name) WHERE type = 'note';
CREATE INDEX IF NOT EXISTS idx_nodes_xy ON nodes(x, y);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_vault_path ON nodes(vault_path) WHERE vault_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS edges (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'related',
    properties  TEXT NOT NULL DEFAULT '{}',
    weight      REAL DEFAULT 1.0,
    directed    INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, target_id, label)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_label ON edges(label);

CREATE TABLE IF NOT EXISTS entity_aliases (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,
    alias_lower TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aliases_lower ON entity_aliases(alias_lower);

CREATE TABLE IF NOT EXISTS ontology_node_types (
    type        TEXT PRIMARY KEY,
    description TEXT,
    color       TEXT,
    category    TEXT NOT NULL DEFAULT 'entity_label'
);
INSERT OR IGNORE INTO ontology_node_types (type, description, color, category) VALUES
    ('resource', 'A webpage ingested into the knowledge graph', '#059669', 'structural'),
    ('entity', 'A domain object (concept, person, technology, etc.)', '#7C3AED', 'structural'),
    ('note', 'A granular prose unit about entities', '#0EA5E9', 'structural');

CREATE TABLE IF NOT EXISTS ontology_edge_types (
    type        TEXT PRIMARY KEY,
    description TEXT,
    category    TEXT NOT NULL DEFAULT 'related'
);
INSERT OR IGNORE INTO ontology_edge_types (type, description, category) VALUES
    ('subfield_of', 'Hierarchical subfield relationship', 'hierarchical'),
    ('part_of', 'Part-whole relationship', 'hierarchical'),
    ('instance_of', 'Instance of a class or category', 'hierarchical'),
    ('created_by', 'Attribution to creator', 'attribution'),
    ('affiliated_with', 'Organizational affiliation', 'attribution'),
    ('used_in', 'Usage in a system or context', 'semantic'),
    ('builds_on', 'Extends or builds upon', 'semantic'),
    ('enables', 'Enables or makes possible', 'semantic'),
    ('contradicts', 'Contradicts or disagrees with', 'contrast'),
    ('alternative_to', 'Alternative approach', 'contrast'),
    ('preceded_by', 'Temporal precedence', 'temporal'),
    ('about', 'Note is primarily about entity', 'semantic'),
    ('mention', 'Note references entity secondarily', 'semantic'),
    ('extracted_from', 'Provenance link to source resource', 'provenance'),
    ('references', 'Citation or link between notes', 'semantic'),
    ('related', 'Generic related-to relationship', 'related');

CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (node_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag);

CREATE TABLE IF NOT EXISTS entity_sources (
    entity_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    resource_id   TEXT NOT NULL,
    relation_type TEXT NOT NULL DEFAULT 'about',
    location      TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (entity_id, resource_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_entity_sources_resource ON entity_sources(resource_id);

CREATE TABLE IF NOT EXISTS edge_sources (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_id      TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
    source_type  TEXT NOT NULL CHECK(source_type IN ('note', 'extraction', 'user')),
    source_id    TEXT,
    resource_id  TEXT,
    location     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(edge_id, source_type, source_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_edge_sources_edge ON edge_sources(edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_sources_note ON edge_sources(source_id);

CREATE TABLE IF NOT EXISTS note_attachments (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    note_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    mime_type  TEXT NOT NULL,
    data       BLOB,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id);

CREATE TABLE IF NOT EXISTS note_search (
    rowid   INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT UNIQUE NOT NULL,
    title   TEXT NOT NULL,
    body    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_content (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id      TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    url          TEXT NOT NULL,
    title        TEXT,
    content      TEXT NOT NULL,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_source_content_node ON source_content(node_id);
CREATE INDEX IF NOT EXISTS idx_source_content_url ON source_content(url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_content_url_time ON source_content(url, extracted_at);

CREATE TABLE IF NOT EXISTS reading_list_history (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    url        TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL,
    summary    TEXT NOT NULL DEFAULT '',
    key_topics TEXT NOT NULL DEFAULT '[]',
    merged_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rlh_merged ON reading_list_history(merged_at DESC);

CREATE TABLE IF NOT EXISTS embedding_metadata (
    node_id   TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    text_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id             TEXT PRIMARY KEY,
    title          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    status         TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'complete',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS artifacts (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    type        TEXT NOT NULL,
    session_id  TEXT,
    session_dir TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
CREATE INDEX IF NOT EXISTS idx_artifacts_updated ON artifacts(updated_at DESC);
`;

export const fts5DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    name,
    type,
    properties,
    content='nodes',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, name, type, properties)
    VALUES (new.rowid, new.name, new.type, new.properties);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, name, type, properties)
    VALUES ('delete', old.rowid, old.name, old.type, old.properties);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, name, type, properties)
    VALUES ('delete', old.rowid, old.name, old.type, old.properties);
    INSERT INTO nodes_fts(rowid, name, type, properties)
    VALUES (new.rowid, new.name, new.type, new.properties);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title,
    body,
    content='note_search',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS note_search_ai AFTER INSERT ON note_search BEGIN
    INSERT INTO notes_fts(rowid, title, body)
    VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS note_search_ad AFTER DELETE ON note_search BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER IF NOT EXISTS note_search_au AFTER UPDATE ON note_search BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO notes_fts(rowid, title, body)
    VALUES (new.rowid, new.title, new.body);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
    id UNINDEXED,
    title,
    text_content,
    tokenize='unicode61'
);
`;
