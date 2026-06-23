import type { DataStore } from '../db/data-store';
import type { PlatformStorage, PlatformNotes, PlatformFiles, PlatformLLM, PlatformBrowser, PlatformArtifacts } from '../platform/types';
import type { GraphNode, GraphEdge, DbNode, DbEdge, NodeType } from '../shared/types';
import type { SemanticSearchResult } from '../embeddings/types';

export interface CommandContext {
  db: DataStore;
  storage: PlatformStorage;
  notes: PlatformNotes;
  files: PlatformFiles;
  llm: PlatformLLM;
  browser: PlatformBrowser;
  artifacts?: PlatformArtifacts;
  embedding?: {
    searchSimilar(query: string, topK?: number): Promise<SemanticSearchResult[]>;
  };
  entityFiles?: {
    read(nodeId: string): Promise<{ path: string; content: string; contentHash: string | null } | null>;
    append(nodeId: string, text: string, expectedHash?: string): Promise<{ contentHash: string }>;
    patch(nodeId: string, patch: { oldText: string; newText: string }, expectedHash?: string): Promise<{ contentHash: string }>;
  };
  getGraphSnapshot(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
}

export interface CommandResult<T> {
  data: T;
  events: CommandEvent[];
}

export type CommandEvent =
  | { type: 'node_created'; node: DbNode }
  | { type: 'node_updated'; node: DbNode }
  | { type: 'node_deleted'; id: string }
  | { type: 'edge_created'; edge: DbEdge }
  | { type: 'edge_updated'; edge: DbEdge }
  | { type: 'edge_deleted'; id: string }
  | { type: 'note_content_updated'; nodeId: string }
  | { type: 'node_type_created'; nodeType: NodeType }
  | { type: 'node_type_deleted'; nodeTypeId: string }
  | { type: 'reset' };
