export const version = 9;
export const description = 'Embedding metadata and dismissals tables (optional)';
export const optional = true;

export const up = `
CREATE TABLE IF NOT EXISTS embedding_metadata (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedded_at TEXT NOT NULL,
  text_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embedding_dismissals (
  node_id_a TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  node_id_b TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (node_id_a, node_id_b)
);
`;
