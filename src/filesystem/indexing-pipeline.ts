/**
 * Markdown indexing pipeline: reads .md files from a folder, parses them,
 * creates resource nodes and edges for wiki-links, tracks indexed files.
 */

import { nodes, edges, sourceContent, indexedFiles, entityResolution } from '../db/client/db-client';
import { readMarkdownFiles, getFileMetadata, writeMarkdownFile, type MarkdownFile } from './folder-access';
import { parseMarkdown } from './markdown-parser';
import type { DbIndexedFile } from '../shared/types';

export interface FolderStat {
  folderPath: string;
  fileCount: number;
}

export interface IndexingProgress {
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  currentFile: string | null;
  folderStats?: FolderStat[];
  rootIndexContent?: string;
}

export type ProgressCallback = (progress: IndexingProgress) => void;

function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

/**
 * Index all markdown files from a directory handle.
 * Incremental: only re-indexes new or modified files.
 */
export async function indexMarkdownFolder(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: ProgressCallback
): Promise<IndexingProgress> {
  const progress: IndexingProgress = {
    total: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    currentFile: null,
  };

  // Get current file metadata to detect changes
  const fileMetadata = await getFileMetadata(dirHandle);
  progress.total = fileMetadata.length;
  onProgress?.(progress);

  // Get already-indexed files from DB
  const existingFiles: DbIndexedFile[] = await indexedFiles.getAll();
  const existingByPath = new Map(existingFiles.map((f) => [f.file_path, f]));

  // Determine which files need indexing
  const toIndex: Array<{ path: string; name: string; lastModified: number; isNew: boolean }> = [];
  const currentPaths = new Set<string>();

  for (const meta of fileMetadata) {
    currentPaths.add(meta.path);
    const existing = existingByPath.get(meta.path);

    if (!existing) {
      toIndex.push({ ...meta, isNew: true });
    } else if (existing.last_modified < meta.lastModified) {
      toIndex.push({ ...meta, isNew: false });
    } else {
      progress.skipped++;
      progress.processed++;
      onProgress?.(progress);
    }
  }

  // Clean up removed files
  for (const [path] of existingByPath) {
    if (!currentPaths.has(path)) {
      await indexedFiles.delete(path);
    }
  }

  // Read and index files that need updating
  if (toIndex.length > 0) {
    // Read only files that need indexing
    const allFiles = await readMarkdownFiles(dirHandle);
    const filesByPath = new Map(allFiles.map((f) => [f.path, f]));

    for (const item of toIndex) {
      progress.currentFile = item.path;
      onProgress?.(progress);

      const file = filesByPath.get(item.path);
      if (!file) {
        progress.processed++;
        continue;
      }

      try {
        await indexSingleFile(file, item.isNew, existingByPath.get(item.path));
        if (item.isNew) {
          progress.created++;
        } else {
          progress.updated++;
        }
      } catch (e) {
        console.warn(`[Indexing] Failed to index ${item.path}:`, e);
      }

      progress.processed++;
      onProgress?.(progress);
    }
  }

  progress.currentFile = null;

  // Generate _kg_index.md per folder
  try {
    const allFiles = await readMarkdownFiles(dirHandle);
    const { folderStats, rootIndex } = await generateFolderIndexes(dirHandle, allFiles);
    progress.folderStats = folderStats;
    progress.rootIndexContent = rootIndex;
  } catch (e) {
    console.warn('[Indexing] Failed to generate folder indexes:', e);
  }

  onProgress?.(progress);
  return progress;
}

async function indexSingleFile(
  file: MarkdownFile,
  isNew: boolean,
  existingRecord?: DbIndexedFile
): Promise<void> {
  const parsed = parseMarkdown(file.content);
  const contentHash = hashContent(file.content);
  const title = parsed.title ?? file.name.replace(/\.md$/, '');
  const sourceUrl = `file://${file.path}`;

  let nodeId: string;

  if (isNew || !existingRecord?.node_id) {
    // Create a resource node for this file
    const node = await nodes.create({
      label: title,
      type: 'resource',
      sourceUrl,
      properties: JSON.stringify({
        filePath: file.path,
        ...(Object.keys(parsed.frontmatter).length > 0 ? { frontmatter: parsed.frontmatter } : {}),
      }),
    });
    nodeId = node.id;
  } else {
    nodeId = existingRecord.node_id;
    // Update the existing node
    await nodes.update({
      id: nodeId,
      label: title,
      properties: JSON.stringify({
        filePath: file.path,
        ...(Object.keys(parsed.frontmatter).length > 0 ? { frontmatter: parsed.frontmatter } : {}),
      }),
    });
  }

  // Store file content as source content
  await sourceContent.save({
    nodeId,
    url: sourceUrl,
    title,
    content: file.content,
  });

  // Track the indexed file
  await indexedFiles.save({
    filePath: file.path,
    fileName: file.name,
    lastModified: file.lastModified,
    contentHash,
    nodeId,
  });

  // Create edges for wiki-links
  for (const linkLabel of parsed.wikiLinks) {
    // Try to find matching node via entity resolution
    try {
      const matches = await entityResolution.findMatches(linkLabel);
      if (matches.length > 0) {
        const targetId = matches[0].nodeId;
        if (targetId !== nodeId) {
          try {
            await edges.create({
              sourceId: nodeId,
              targetId,
              label: 'links_to',
              type: 'reference',
              sourceUrl,
            });
          } catch {
            // Edge may already exist (UNIQUE constraint)
          }
        }
      }
    } catch {
      // Entity resolution not available, skip
    }
  }
}

function generateFileSummary(content: string): string {
  const parsed = parseMarkdown(content);
  if (parsed.frontmatter.description) {
    return parsed.frontmatter.description.slice(0, 80);
  }
  if (parsed.title) {
    return parsed.title.slice(0, 80);
  }
  const firstParagraph = content
    .split('\n')
    .find((line) => line.trim() && !line.startsWith('#') && !line.startsWith('---'));
  if (firstParagraph) {
    return firstParagraph.trim().slice(0, 80);
  }
  return '';
}

async function generateFolderIndexes(
  dirHandle: FileSystemDirectoryHandle,
  allFiles: MarkdownFile[],
): Promise<{ folderStats: FolderStat[]; rootIndex: string }> {
  const folderMap = new Map<string, MarkdownFile[]>();
  const subfolderCounts = new Map<string, Map<string, number>>();

  for (const file of allFiles) {
    const lastSlash = file.path.lastIndexOf('/');
    const folder = lastSlash === -1 ? '' : file.path.slice(0, lastSlash);
    if (!folderMap.has(folder)) folderMap.set(folder, []);
    folderMap.get(folder)!.push(file);

    // Track subfolder counts for parent
    if (folder) {
      const parentSlash = folder.lastIndexOf('/');
      const parent = parentSlash === -1 ? '' : folder.slice(0, parentSlash);
      const subName = parentSlash === -1 ? folder : folder.slice(parentSlash + 1);
      if (!subfolderCounts.has(parent)) subfolderCounts.set(parent, new Map());
      subfolderCounts.get(parent)!.set(subName, (folderMap.get(folder)?.length ?? 0));
    }
  }

  const folderStats: FolderStat[] = [];
  let rootIndex = '';
  const now = new Date().toISOString().split('T')[0];

  for (const [folder, files] of folderMap) {
    const displayPath = folder || '/';
    const fileLines = files.map((f) => {
      const summary = generateFileSummary(f.content);
      return `- **${f.name}** — ${summary}`;
    });

    const subs = subfolderCounts.get(folder);
    const subLines: string[] = [];
    if (subs) {
      for (const [subName, count] of subs) {
        subLines.push(`- \`${subName}/\` (${count} files)`);
      }
    }

    let indexContent = `# Index: ${displayPath}\n\n> Auto-generated by Knowledge Graph. Last updated: ${now}\n\n`;
    indexContent += `## Files (${files.length})\n\n${fileLines.join('\n')}\n`;
    if (subLines.length > 0) {
      indexContent += `\n## Subfolders\n\n${subLines.join('\n')}\n`;
    }

    const indexPath = folder ? `${folder}/_kg_index.md` : '_kg_index.md';
    await writeMarkdownFile(dirHandle, indexPath, indexContent);

    folderStats.push({ folderPath: folder || '/', fileCount: files.length });
    if (folder === '') {
      rootIndex = indexContent.slice(0, 3000);
    }
  }

  return { folderStats, rootIndex };
}
