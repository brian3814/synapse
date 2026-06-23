import type { DbNode, DbEdge, NodeType } from './types';

export const SYNC_CHANNEL = 'kg_extension_sync';

export type SyncEvent =
  | { type: 'node_created'; node: DbNode }
  | { type: 'node_updated'; node: DbNode }
  | { type: 'node_deleted'; id: string }
  | { type: 'edge_created'; edge: DbEdge }
  | { type: 'edge_updated'; edge: DbEdge }
  | { type: 'edge_deleted'; id: string }
  | { type: 'node_type_created'; nodeType: NodeType }
  | { type: 'node_type_deleted'; nodeTypeId: string }
  | { type: 'note_content_updated'; nodeId: string }
  | { type: 'reset' };
