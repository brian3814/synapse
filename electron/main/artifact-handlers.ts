import { ipcMain, BrowserWindow } from 'electron';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ArtifactType, ArtifactRecord, ArtifactMeta } from '../../src/shared/artifact-types';
import { slugify, ARTIFACT_EXTENSIONS } from '../../src/shared/artifact-types';
import * as artifactQueries from '../../src/db/worker/queries/artifact-queries';

let currentVaultPath: string | null = null;

export function initArtifactHandlers(vaultPath: string): void {
  currentVaultPath = vaultPath;
}

function getArtifactsDir(): string {
  if (!currentVaultPath) throw new Error('No vault open — cannot access artifacts');
  return path.join(currentVaultPath, '.kg', 'artifacts');
}

function extractTextContent(type: ArtifactType, content: string): string {
  switch (type) {
    case 'html':
      return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    case 'svg': {
      const textMatches = content.match(/<text[^>]*>([^<]*)<\/text>/g) || [];
      return textMatches.map(m => m.replace(/<[^>]*>/g, '')).join(' ');
    }
    case 'jsx':
      return content
        .replace(/import\s+.*?from\s+['"].*?['"]/g, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    case 'markdown':
    case 'mermaid':
    default:
      return content;
  }
}

/**
 * Find or create a session directory under .kg/artifacts/.
 * Format: {YYYY-MM-DD}-{session-title-slug}
 * Reuses existing dir if a .meta.json inside matches sessionId.
 * Appends -2, -3 etc. on slug collision with a different session.
 */
function resolveSessionDir(
  artifactsRoot: string,
  sessionId: string,
  sessionTitle: string,
): string {
  const datePrefix = new Date().toISOString().slice(0, 10);
  const baseSlug = slugify(sessionTitle);
  const baseName = `${datePrefix}-${baseSlug}`;

  // Check if any existing directory already belongs to this sessionId
  if (existsSync(artifactsRoot)) {
    for (const entry of readdirSync(artifactsRoot)) {
      const entryPath = path.join(artifactsRoot, entry);
      try {
        const files = readdirSync(entryPath);
        for (const f of files) {
          if (!f.endsWith('.meta.json')) continue;
          const meta: ArtifactMeta = JSON.parse(
            readFileSync(path.join(entryPath, f), 'utf-8'),
          );
          if (meta.sessionId === sessionId) return entry;
        }
      } catch {
        // Not a directory or unreadable — skip
      }
    }
  }

  // No existing match — find a non-colliding name
  let dirName = baseName;
  let counter = 2;
  while (existsSync(path.join(artifactsRoot, dirName))) {
    dirName = `${baseName}-${counter}`;
    counter++;
  }
  mkdirSync(path.join(artifactsRoot, dirName), { recursive: true });
  return dirName;
}

/**
 * Resolve a unique file name inside a session directory.
 * Format: {title-slug}.{ext} with collision suffix -2, -3 etc.
 */
function resolveFileName(sessionDirPath: string, title: string, type: ArtifactType): string {
  const slug = slugify(title);
  const ext = ARTIFACT_EXTENSIONS[type];
  let fileName = `${slug}${ext}`;
  let counter = 2;
  while (existsSync(path.join(sessionDirPath, fileName))) {
    fileName = `${slug}-${counter}${ext}`;
    counter++;
  }
  return fileName;
}

function broadcastChange(record: ArtifactRecord): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('artifacts:changed', record);
  }
}

export function registerArtifactIPC(): void {
  ipcMain.handle('artifacts:list', async () => {
    return artifactQueries.listArtifacts();
  });

  ipcMain.handle('artifacts:get', async (_event, id: string) => {
    return artifactQueries.getArtifact(id);
  });

  ipcMain.handle('artifacts:getContent', async (_event, id: string) => {
    const record = await artifactQueries.getArtifact(id);
    if (!record) return null;
    const filePath = path.join(getArtifactsDir(), record.sessionDir, record.fileName);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle(
    'artifacts:create',
    async (
      _event,
      payload: {
        title: string;
        type: ArtifactType;
        content: string;
        sessionId: string;
        sessionTitle: string;
      },
    ) => {
      const { title, type, content, sessionId, sessionTitle } = payload;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const artifactsRoot = getArtifactsDir();
      mkdirSync(artifactsRoot, { recursive: true });

      const sessionDir = resolveSessionDir(artifactsRoot, sessionId, sessionTitle);
      const sessionDirPath = path.join(artifactsRoot, sessionDir);
      mkdirSync(sessionDirPath, { recursive: true });

      const fileName = resolveFileName(sessionDirPath, title, type);

      // Write content file
      writeFileSync(path.join(sessionDirPath, fileName), content, 'utf-8');

      // Write .meta.json
      const meta: ArtifactMeta = {
        id,
        title,
        type,
        sessionId,
        sessionDir,
        createdAt: now,
        updatedAt: now,
      };
      const metaFileName = fileName.replace(/\.[^.]+$/, '.meta.json');
      writeFileSync(
        path.join(sessionDirPath, metaFileName),
        JSON.stringify(meta, null, 2),
        'utf-8',
      );

      // Insert into DB
      const record: ArtifactRecord = { ...meta, fileName };
      await artifactQueries.insertArtifact(record);

      // Index text content for FTS
      const textContent = extractTextContent(type, content);
      await artifactQueries.updateArtifactFts(id, textContent);

      broadcastChange(record);
      return record;
    },
  );

  ipcMain.handle(
    'artifacts:update',
    async (
      _event,
      payload: { id: string; title: string; content: string },
    ) => {
      const { id, title, content } = payload;
      const existing = await artifactQueries.getArtifact(id);
      if (!existing) throw new Error(`Artifact ${id} not found`);

      const now = new Date().toISOString();
      const sessionDirPath = path.join(getArtifactsDir(), existing.sessionDir);

      // Overwrite content file
      writeFileSync(path.join(sessionDirPath, existing.fileName), content, 'utf-8');

      // Overwrite .meta.json
      const meta: ArtifactMeta = {
        id,
        title,
        type: existing.type,
        sessionId: existing.sessionId,
        sessionDir: existing.sessionDir,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      const metaFileName = existing.fileName.replace(/\.[^.]+$/, '.meta.json');
      writeFileSync(
        path.join(sessionDirPath, metaFileName),
        JSON.stringify(meta, null, 2),
        'utf-8',
      );

      // Update DB
      await artifactQueries.updateArtifactRow(id, title, now);
      const textContent = extractTextContent(existing.type, content);
      await artifactQueries.updateArtifactFts(id, textContent);

      const record: ArtifactRecord = { ...meta, fileName: existing.fileName };
      broadcastChange(record);
      return record;
    },
  );

  ipcMain.handle('artifacts:delete', async (_event, id: string) => {
    const existing = await artifactQueries.getArtifact(id);
    if (!existing) return;

    const sessionDirPath = path.join(getArtifactsDir(), existing.sessionDir);

    // Remove content file
    const contentPath = path.join(sessionDirPath, existing.fileName);
    try { unlinkSync(contentPath); } catch { /* not found */ }

    // Remove .meta.json
    const metaFileName = existing.fileName.replace(/\.[^.]+$/, '.meta.json');
    const metaPath = path.join(sessionDirPath, metaFileName);
    try { unlinkSync(metaPath); } catch { /* not found */ }

    // Clean up empty session directory
    try {
      const remaining = readdirSync(sessionDirPath);
      if (remaining.length === 0) {
        const { rmdirSync } = require('fs');
        rmdirSync(sessionDirPath);
      }
    } catch { /* directory may not exist or not empty */ }

    // Remove from DB
    await artifactQueries.deleteArtifactRow(id);
  });

  ipcMain.handle('artifacts:search', async (_event, query: string) => {
    return artifactQueries.searchArtifacts(query);
  });
}
