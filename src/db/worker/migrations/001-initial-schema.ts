export const version = 1;
export const description = 'Initial schema: nodes, edges, entity_aliases, extraction_log, ontology';

export const up = `
CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    identifier  TEXT UNIQUE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'concept',
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
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_identifier ON nodes(identifier);

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
    parent_type       TEXT REFERENCES ontology_node_types(type),
    properties_schema TEXT
);

INSERT OR IGNORE INTO ontology_node_types (type, description, color) VALUES
    ('resource', 'A document, URL, file, or other information resource', '#059669'),
    ('concept', 'An idea, topic, category, or abstract concept', '#7C3AED');

CREATE TABLE IF NOT EXISTS ontology_edge_types (
    type              TEXT PRIMARY KEY,
    description       TEXT,
    source_types      TEXT,
    target_types      TEXT,
    properties_schema TEXT
);

CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (node_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag);

CREATE TABLE IF NOT EXISTS concept_sources (
    concept_id          TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    resource_identifier TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (concept_id, resource_identifier)
);
CREATE INDEX IF NOT EXISTS idx_concept_sources_resource ON concept_sources(resource_identifier);
`;
