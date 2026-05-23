export const version = 10;
export const description = 'Ingestion provenance: location on sources, vault_path and content_type on nodes';

export const up = `
ALTER TABLE entity_sources ADD COLUMN location TEXT;
ALTER TABLE edge_sources ADD COLUMN location TEXT;
ALTER TABLE nodes ADD COLUMN vault_path TEXT;
ALTER TABLE nodes ADD COLUMN content_type TEXT;
`;
