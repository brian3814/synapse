export type CleanupCategory = 'graph' | 'chat' | 'artifacts' | 'memories' | 'notes' | 'entityFiles' | 'vaultFiles';

export type CategoryStatus = 'pending' | 'in-progress' | 'done' | 'error';

export const ALL_CATEGORIES: CleanupCategory[] = [
  'graph', 'chat', 'artifacts', 'memories', 'notes', 'entityFiles', 'vaultFiles',
];

export interface CategoryCounts {
  nodes: number;
  edges: number;
  chatSessions: number;
  artifacts: number;
  memories: number;
  notes: number;
  entityFiles: { fileCount: number; bytes: number };
  vaultFiles: { fileCount: number; bytes: number };
}

export interface CleanupError {
  category: CleanupCategory;
  message: string;
}

export interface CleanupResult {
  errors: CleanupError[];
}

export function pathMatches(input: string, vaultPath: string): boolean {
  return input === vaultPath;
}

export function buildSelectedSet(counts: CategoryCounts): Set<CleanupCategory> {
  const selected = new Set<CleanupCategory>();
  if (counts.nodes > 0 || counts.edges > 0) selected.add('graph');
  if (counts.chatSessions > 0) selected.add('chat');
  if (counts.artifacts > 0) selected.add('artifacts');
  if (counts.memories > 0) selected.add('memories');
  if (counts.notes > 0) selected.add('notes');
  // entityFiles intentionally not pre-selected — can be regenerated from graph data
  if (counts.vaultFiles.fileCount > 0) selected.add('vaultFiles');
  return selected;
}

export function categoriesToDelete(selected: Set<CleanupCategory>): CleanupCategory[] {
  return ALL_CATEGORIES.filter(c => selected.has(c));
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export async function executeCleanup(
  selected: Set<CleanupCategory>,
  deleters: Record<CleanupCategory, () => Promise<void>>,
  onProgress: (category: CleanupCategory, status: CategoryStatus) => void,
): Promise<CleanupResult> {
  const errors: CleanupError[] = [];
  const ordered = categoriesToDelete(selected);

  for (const category of ordered) {
    onProgress(category, 'in-progress');
    try {
      await deleters[category]();
      onProgress(category, 'done');
    } catch (err) {
      onProgress(category, 'error');
      errors.push({ category, message: (err as Error).message });
    }
  }

  return { errors };
}
