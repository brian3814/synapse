import type { SourceLocation } from '../ingestion/types';

// Page complexity metrics (from content script)
export interface PageComplexity {
  wordCount: number;
  headingCount: number;
  tableCount: number;
  listCount: number;
  jsonLdCount: number;
}

// Database row types

/**
 * Structural layer of a node in the three-layer knowledge model.
 * - resource: an ingested webpage (immutable input, system-created)
 * - entity:   a domain object (concept, person, technology, etc.)
 * - note:     a granular prose unit about entities
 */
export type StructuralNodeType = 'resource' | 'entity' | 'note';

export interface DbNode {
  id: string;
  identifier: string | null;
  name: string;
  type: string; // StructuralNodeType: 'resource' | 'entity' | 'note'
  label: string | null; // entity semantic label (e.g., 'concept', 'person'); null for resource/note
  summary: string | null; // cached LLM-generated entity summary
  properties: string; // JSON string
  x: number | null;
  y: number | null;
  color: string | null;
  size: number;
  source_url: string | null;
  vault_path: string | null; // vault-relative file path (e.g. 'notes/Machine Learning.md')
  file_mtime: number | null; // last known file modification time (ms since epoch)
  file_size: number | null; // last known file size in bytes
  created_at: string;
  updated_at: string;
}

export interface DbEdge {
  id: string;
  source_id: string;
  target_id: string;
  label: string;
  type: string;
  properties: string; // JSON string
  weight: number;
  directed: number; // 0 or 1
  created_at: string;
  updated_at: string;
}

export interface DbEntityAlias {
  id: string;
  node_id: string;
  alias: string;
  alias_lower: string;
}

export interface DbExtractionLog {
  id: string;
  source_url: string | null;
  source_text: string | null;
  provider: string;
  model: string;
  raw_output: string | null;
  nodes_added: number;
  edges_added: number;
  created_at: string;
}

export interface DbSourceContent {
  id: string;
  node_id: string | null;
  url: string;
  title: string | null;
  content: string;
  content_hash: string | null;
  extracted_at: string;
  created_at: string;
}

// Edge provenance row from edge_sources table
export interface DbEdgeSource {
  id: number;
  edge_id: string;
  source_type: 'note' | 'extraction' | 'user';
  source_id: string | null; // note node ID (when source_type='note')
  resource_id: string | null; // resource node ID (when source_type='extraction')
  location: string | null; // JSON-serialized SourceLocation (page/region/time/selector)
  created_at: string;
}

// Entity-to-resource provenance row from entity_sources table
export interface DbEntitySource {
  entity_id: string;
  resource_id: string;
  relation_type: 'about' | 'mention';
  location: string | null; // JSON-serialized SourceLocation (page/region/time/selector)
  created_at: string;
}

// Note folder marker row (zero-byte folder markers for empty user-created folders)
export interface DbNoteFolder {
  path: string;
  created_at: string;
}

export interface DbNoteAttachment {
  id: string;
  note_id: string;
  filename: string;
  mime_type: string;
  data: Uint8Array | null;
  source_url: string | null;
  created_at: string;
}

// Slim projections for bulk graph loading (skip properties, timestamps)
export interface DbNodeSlim {
  id: string;
  identifier: string | null;
  name: string;
  type: string;
  label: string | null;
  color: string | null;
  size: number;
  source_url: string | null;
  x: number | null;
  y: number | null;
}

export interface DbEdgeSlim {
  id: string;
  source_id: string;
  target_id: string;
  label: string;
  type: string;
  weight: number;
  directed: number;
}

// Application types (parsed from DB rows)
export interface GraphNode {
  id: string;
  identifier: string | null;
  name: string;
  type: string; // StructuralNodeType: 'resource' | 'entity' | 'note'
  label?: string | null; // entity semantic label
  summary?: string | null; // cached LLM-generated entity summary
  properties: Record<string, unknown>;
  tags?: string[];
  x?: number;
  y?: number;
  color?: string;
  size: number;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
  weight: number;
  directed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Input types for creating/updating
export interface CreateNodeInput {
  name: string;
  type?: string;
  label?: string;
  identifier?: string;
  properties?: Record<string, unknown>;
  tags?: string[];
  color?: string;
  size?: number;
  sourceUrl?: string;
}

export interface UpdateNodeInput {
  id: string;
  name?: string;
  type?: string;
  label?: string;
  summary?: string;
  properties?: Record<string, unknown>;
  tags?: string[];
  x?: number;
  y?: number;
  color?: string;
  size?: number;
}

export interface CreateEdgeInput {
  sourceId: string;
  targetId: string;
  label: string;
  type?: string;
  properties?: Record<string, unknown>;
  weight?: number;
  directed?: boolean;
  /**
   * When true, graph.createEdge will NOT auto-write a user-attributed
   * edge_sources row. Extraction flows should pass `true` and then record
   * their own `extraction` or `note` provenance row.
   */
  skipProvenance?: boolean;
}

export interface UpdateEdgeInput {
  id: string;
  label?: string;
  type?: string;
  properties?: Record<string, unknown>;
  weight?: number;
}

// Source content input
export interface CreateSourceContentInput {
  nodeId?: string;
  url: string;
  title?: string;
  content: string;
}

// Entity resolution types
export interface EntityMatch {
  nodeId: string;
  name: string;
  matchType: 'exact' | 'alias' | 'fuzzy';
  similarity: number;
}

// LLM types
export type LLMProvider = 'anthropic';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
}

export interface ExtractionResult {
  nodes: Array<{
    name: string;
    type?: string; // legacy; entities may omit type entirely
    label?: string; // entity semantic label (concept, person, technology, ...)
    properties?: Record<string, unknown>;
    tags?: string[];
    sourceLocation?: SourceLocation;
  }>;
  edges: Array<{
    sourceName: string;
    targetName: string;
    label: string;
    type?: string;
    sourceLocation?: SourceLocation;
  }>;
}

export interface DiffItem {
  action: 'add' | 'merge' | 'skip';
  type: 'node' | 'edge';
  extracted: ExtractionResult['nodes'][0] | ExtractionResult['edges'][0];
  existingMatch?: GraphNode | GraphEdge;
  accepted: boolean;
}

/**
 * Prose note candidate emitted by the LLM when the extractionNotesEnabled
 * toggle is on. Stored alongside node/edge diff items so they can be
 * carried into the review store in proceedToReview().
 */
export interface ExtractedNoteCandidate {
  title: string;
  content: string;
  about: string[]; // entity names (resolved to review temp IDs later)
  mentions: string[];
}

export interface ExtractionDiff {
  items: DiffItem[];
  notes?: ExtractedNoteCandidate[];
}

// Node type (from ontology_node_types table).
// In the three-layer model, this table stores both structural types and entity labels:
// - category='structural': the three fixed layer types (resource, entity, note)
// - category='entity_label': user-extensible semantic categorization for entities
export interface NodeType {
  type: string;
  description: string | null;
  color: string | null;
  category: 'structural' | 'entity_label';
  isDefault: boolean;
}

// Agent step types
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'error';

export interface AgentStep {
  id: string;
  label: string;
  status: AgentStepStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  output?: string;
}

export interface AgentRun {
  id: string;
  steps: AgentStep[];
  currentStepIndex: number;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  completedAt?: number;
}

// Agent tool-use types
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AgentProgressEventType =
  | 'llm_start'
  | 'llm_chunk'
  | 'llm_end'
  | 'tool_call'
  | 'tool_result'
  | 'extraction_complete'
  | 'error'
  | 'done';

export interface AgentProgressEvent {
  type: AgentProgressEventType;
  text?: string;
  toolCall?: ToolCall;
  toolResult?: string;
  toolError?: string;
  extractionResult?: ExtractionResult;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface AgentTurn {
  type: 'thinking' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  collapsed?: boolean;
}

export interface ChatAgentTurn {
  type: 'thinking' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
}

// Display mode
export type DisplayMode = 'sidePanel' | 'tab' | 'desktop';

// Settings
export interface AppSettings {
  displayMode: DisplayMode;
  llmConfig?: LLMConfig;
  defaultLayout: string;
}

// Reading list types
export type ReadingListItemStatus = 'pending' | 'processing' | 'ready' | 'complete' | 'failed'
  | 'fetching' | 'extracting' | 'extracted'; // Chrome legacy

// Stored in chrome.storage.local by the SW
export interface ReadingListItem {
  url: string;
  title: string;
  addedAt: number; // ms timestamp
  status: ReadingListItemStatus;
  error?: string;
  summary?: string;
  keyTopics?: string[];
  extractedNodes?: Array<{ name: string; type: string; properties?: Record<string, unknown> }>;
  extractedEdges?: Array<{ sourceName: string; targetName: string; label: string; type?: string }>;
  pageContent?: string;  // cleaned HTML text for source_content saving on merge
  pageTitle?: string;
  extractedAt?: number;
  targetVaultPath?: string;
  targetVaultName?: string;
}
