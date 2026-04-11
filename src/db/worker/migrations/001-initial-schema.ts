export const version = 1;
export const description = 'Initial schema: three-layer knowledge model (resource/entity/note)';

export const up = `
CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    identifier  TEXT UNIQUE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'entity',
    label       TEXT,
    summary     TEXT,
    folder_path TEXT NOT NULL DEFAULT '',
    properties  TEXT NOT NULL DEFAULT '{}',
    x           REAL,
    y           REAL,
    z           REAL,
    color       TEXT,
    size        REAL DEFAULT 1.0,
    source_url  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_identifier ON nodes(identifier);
CREATE INDEX IF NOT EXISTS idx_nodes_folder_path ON nodes(folder_path) WHERE type = 'note';
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_note_name ON nodes(name) WHERE type = 'note';

CREATE TABLE IF NOT EXISTS edges (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'related',
    properties  TEXT NOT NULL DEFAULT '{}',
    weight      REAL DEFAULT 1.0,
    directed    INTEGER NOT NULL DEFAULT 1,
    source_url  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, target_id, label)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

CREATE TABLE IF NOT EXISTS entity_aliases (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,
    alias_lower TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aliases_lower ON entity_aliases(alias_lower);

CREATE TABLE IF NOT EXISTS extraction_log (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_url  TEXT,
    source_text TEXT,
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    raw_output  TEXT,
    nodes_added INTEGER DEFAULT 0,
    edges_added INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT
);

CREATE TABLE IF NOT EXISTS ontology_node_types (
    type              TEXT PRIMARY KEY,
    description       TEXT,
    color             TEXT,
    category          TEXT NOT NULL DEFAULT 'entity_label',
    is_default        INTEGER NOT NULL DEFAULT 0,
    parent_type       TEXT REFERENCES ontology_node_types(type),
    properties_schema TEXT
);

INSERT OR IGNORE INTO ontology_node_types (type, description, color, category) VALUES
    ('resource', 'A webpage ingested into the knowledge graph', '#059669', 'structural'),
    ('entity', 'A domain object (concept, person, technology, etc.)', '#7C3AED', 'structural'),
    ('note', 'A granular prose unit about entities', '#0EA5E9', 'structural');

INSERT OR IGNORE INTO ontology_node_types (type, description, color, category, is_default) VALUES
    ('concept', 'Abstract idea, topic, field, or theory', '#7C3AED', 'entity_label', 1),
    ('person', 'Named individual', '#4F46E5', 'entity_label', 0),
    ('organization', 'Company, institution, or research group', '#D97706', 'entity_label', 0),
    ('technology', 'Tool, framework, language, or protocol', '#DC2626', 'entity_label', 0),
    ('event', 'Dated occurrence, release, or discovery', '#0891B2', 'entity_label', 0),
    ('place', 'Geographic location', '#65A30D', 'entity_label', 0),
    ('methodology', 'Process, workflow, or design pattern', '#DB2777', 'entity_label', 0);

CREATE TABLE IF NOT EXISTS ontology_edge_types (
    type              TEXT PRIMARY KEY,
    description       TEXT,
    category          TEXT NOT NULL DEFAULT 'related',
    source_types      TEXT,
    target_types      TEXT,
    properties_schema TEXT
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
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(edge_id, source_type, source_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_edge_sources_edge ON edge_sources(edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_sources_note ON edge_sources(source_id);

CREATE TABLE IF NOT EXISTS note_folders (
    path       TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS note_attachments (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    note_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    data        BLOB,
    source_url  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id              TEXT PRIMARY KEY,
    title           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at  TEXT NOT NULL DEFAULT (datetime('now')),
    status          TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    rag_context TEXT,
    status      TEXT NOT NULL DEFAULT 'complete',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS note_search (
    rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id     TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_search_node_id ON note_search(node_id);
`;
