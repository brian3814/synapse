export const version = 2;
export const description = 'FTS5 index on nodes for full-text search (optional)';
export const optional = true; // FTS5 may not be available in the wa-sqlite build

export const up = `
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
`;
