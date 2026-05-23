export const version = 11;
export const description = 'Vault file tracking: mtime/size columns and vault_path unique index';

export const up = `
ALTER TABLE nodes ADD COLUMN file_mtime INTEGER;
ALTER TABLE nodes ADD COLUMN file_size INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_vault_path ON nodes(vault_path) WHERE vault_path IS NOT NULL;
`;
