// --- Mutation tracking ---

export interface MutationResult<T> {
  data: T;
  effects: {
    nodeIds: string[];
    edgeIds: string[];
  };
}

// --- Search ---

export interface SearchResult {
  id: string;
  name: string;
  type: string;
  label: string | null;
  score: number;
  snippet?: string;
  source: 'entity' | 'note' | 'source' | 'semantic';
}

// --- Entities ---

export interface EntityDetail {
  id: string;
  name: string;
  type: string;
  label: string | null;
  summary: string | null;
  properties: Record<string, unknown>;
  aliases: string[];
  tags: string[];
  edges: EntityEdge[];
  sources: EntitySource[];
  created_at: string;
  updated_at: string;
}

export interface EntityEdge {
  id: string;
  direction: 'outgoing' | 'incoming';
  label: string;
  type: string;
  neighbor_id: string;
  neighbor_name: string;
  neighbor_type: string;
}

export interface EntitySource {
  url: string;
  title: string | null;
}

export interface CreateEntityInput {
  name: string;
  label: string;
  properties?: Record<string, unknown>;
  aliases?: string[];
  tags?: string[];
}

export interface UpdateEntityInput {
  entity_id: string;
  name?: string;
  label?: string;
  properties?: Record<string, unknown>;
  aliases?: string[];
  tags?: string[];
}

export interface EntityResult {
  id: string;
  name: string;
  type: string;
  action: 'created' | 'updated' | 'deleted';
}

export interface MergeResult {
  primary_id: string;
  secondary_id: string;
  edges_transferred: number;
  alias_added: string;
}

// --- Relationships ---

export interface CreateRelationshipInput {
  source_id: string;
  target_id: string;
  label: string;
  type?: string;
}

export interface UpdateRelationshipInput {
  relationship_id: string;
  label?: string;
  type?: string;
}

export interface RelationshipResult {
  id: string;
  action: 'created' | 'updated' | 'deleted';
}

// --- Neighbors ---

export interface NeighborNode {
  id: string;
  name: string;
  type: string;
  label: string | null;
  edge_label: string;
  edge_direction: 'outgoing' | 'incoming';
  depth: number;
}

export interface NeighborResult {
  root_id: string;
  nodes: NeighborNode[];
  total: number;
}

// --- Notes ---

export interface NoteResult {
  id: string;
  title: string;
  action: 'read' | 'created' | 'updated';
  content?: string;
}

// --- Analysis ---

export type AnalysisType = 'overview' | 'health' | 'centrality' | 'orphans' | 'paths';

export interface AnalysisResult {
  analysis: AnalysisType;
  data: Record<string, unknown>;
}

// --- Events ---

export type GraphChangeEvent =
  | { type: 'entity_created'; id: string }
  | { type: 'entity_updated'; id: string }
  | { type: 'entity_deleted'; id: string }
  | { type: 'relationship_created'; id: string }
  | { type: 'relationship_deleted'; id: string }
  | { type: 'note_updated'; id: string }
  | { type: 'reset' };
