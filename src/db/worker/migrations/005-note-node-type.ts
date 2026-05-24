export const version = 5;
export const description = 'Note node type (seeded in 001 as part of three-layer model)';

// No-op: the 'note' structural type is now seeded directly in migration 001
// as part of the three-layer knowledge model (resource/entity/note).
// This migration is kept as a no-op to preserve schema_version history.
export const up = `SELECT 1;`;
