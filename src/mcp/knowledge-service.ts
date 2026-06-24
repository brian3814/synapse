import type {
  SearchResult, EntityDetail, CreateEntityInput, UpdateEntityInput,
  EntityResult, MergeResult, MutationResult, NeighborResult,
  CreateRelationshipInput, UpdateRelationshipInput, RelationshipResult,
  NoteResult, AnalysisType, AnalysisResult, GraphChangeEvent,
} from './types';

export interface KnowledgeService {
  search(params: { query: string; scope?: 'all' | 'entities' | 'notes' | 'semantic'; limit?: number }): Promise<SearchResult[]>;

  getEntity(id: string): Promise<EntityDetail | null>;
  createEntity(input: CreateEntityInput): Promise<MutationResult<EntityResult>>;
  updateEntity(input: UpdateEntityInput): Promise<MutationResult<EntityResult>>;
  deleteEntities(ids: string[]): Promise<MutationResult<{ deleted: number }>>;
  mergeEntities(primary_id: string, secondary_id: string): Promise<MutationResult<MergeResult>>;

  getNeighbors(params: { entity_id: string; depth?: number; limit?: number }): Promise<NeighborResult>;

  createRelationship(input: CreateRelationshipInput): Promise<MutationResult<RelationshipResult>>;
  updateRelationship(input: UpdateRelationshipInput): Promise<MutationResult<RelationshipResult>>;
  deleteRelationships(ids: string[]): Promise<MutationResult<{ deleted: number }>>;

  readNote(note_id: string): Promise<NoteResult>;
  createNote(title: string, content: string): Promise<MutationResult<NoteResult>>;
  updateNote(note_id: string, updates: { title?: string; content?: string }): Promise<MutationResult<NoteResult>>;

  analyzeGraph(analysis: AnalysisType, options?: Record<string, unknown>): Promise<AnalysisResult>;

  onGraphChanged(cb: (event: GraphChangeEvent) => void): () => void;
}
