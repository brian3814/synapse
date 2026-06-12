export const version = 6;
export const description = 'Add spatial index on node positions';

export const up = `
CREATE INDEX IF NOT EXISTS idx_nodes_xy ON nodes(x, y)
`;
