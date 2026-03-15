// Database row types
export interface DbNode {
  id: string;
  identifier: string | null;
  label: string;
  type: string;
  properties: string; // JSON string
  x: number | null;
  y: number | null;
  z: number | null;
  color: string | null;
  size: number;
  source_url: string | null;
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
  source_url: string | null;
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

export interface DbIndexedFile {
  id: string;
  file_path: string;
  file_name: string;
  last_modified: number;
  content_hash: string | null;
  node_id: string | null;
  indexed_at: string;
}

// Slim projections for bulk graph loading (skip properties, timestamps)
export interface DbNodeSlim {
  id: string;
  identifier: string | null;
  label: string;
  type: string;
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
  label: string;
  type: string;
  properties: Record<string, unknown>;
  x?: number;
  y?: number;
  z?: number;
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
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Input types for creating/updating
export interface CreateNodeInput {
  label: string;
  type?: string;
  identifier?: string;
  properties?: Record<string, unknown>;
  color?: string;
  size?: number;
  sourceUrl?: string;
}

export interface UpdateNodeInput {
  id: string;
  label?: string;
  type?: string;
  properties?: Record<string, unknown>;
  x?: number;
  y?: number;
  z?: number;
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
  sourceUrl?: string;
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
  label: string;
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
    label: string;
    type: string;
    properties?: Record<string, unknown>;
  }>;
  edges: Array<{
    sourceLabel: string;
    targetLabel: string;
    label: string;
    type?: string;
  }>;
}

export interface DiffItem {
  action: 'add' | 'merge' | 'skip';
  type: 'node' | 'edge';
  extracted: ExtractionResult['nodes'][0] | ExtractionResult['edges'][0];
  existingMatch?: GraphNode | GraphEdge;
  accepted: boolean;
}

export interface ExtractionDiff {
  items: DiffItem[];
}

// Node type (from ontology_node_types table)
export interface NodeType {
  type: string;
  description: string | null;
  color: string | null;
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
}

export interface AgentTurn {
  type: 'thinking' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  collapsed?: boolean;
}

// Display mode
export type DisplayMode = 'sidePanel' | 'tab';

// Settings
export interface AppSettings {
  displayMode: DisplayMode;
  llmConfig?: LLMConfig;
  clusteringEnabled: boolean;
  defaultLayout: string;
}

// Reading list types
export type ReadingListItemStatus = 'pending' | 'fetching' | 'extracting' | 'extracted' | 'failed';

// Stored in chrome.storage.local by the SW
export interface ReadingListItem {
  url: string;
  title: string;
  addedAt: number; // ms timestamp
  status: ReadingListItemStatus;
  error?: string;
  summary?: string;
  keyTopics?: string[];
  extractedNodes?: Array<{ label: string; type: string; properties?: Record<string, unknown> }>;
  extractedEdges?: Array<{ sourceLabel: string; targetLabel: string; label: string; type?: string }>;
  pageContent?: string;  // cleaned HTML text for source_content saving on merge
  pageTitle?: string;
  extractedAt?: number;
}
