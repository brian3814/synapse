import { app, dialog, BrowserWindow } from 'electron';
import { join } from 'path';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from 'fs';
import type { StorageBackend } from './storage-backend';

const STORAGE_KEY = 'notesPath';
const DEFAULT_DIR = join(app.getPath('documents'), 'KnowledgeGraph', 'notes');

let notesDir = DEFAULT_DIR;
let storageRef: StorageBackend | null = null;

export function setStorage(s: StorageBackend): void {
  storageRef = s;
  const saved = s.get(STORAGE_KEY);
  if (saved[STORAGE_KEY] && typeof saved[STORAGE_KEY] === 'string') {
    notesDir = saved[STORAGE_KEY];
  } else {
    s.set({ [STORAGE_KEY]: DEFAULT_DIR });
  }
}

export function initNotesDir(): void {
  if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
}

export function getNotesPath(): string {
  return notesDir;
}

export async function pickNotesFolder(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win!, {
    title: 'Choose Notes Folder',
    defaultPath: notesDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

export function moveNotes(newDir: string): { moved: number; errors: string[] } {
  if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true });

  const files = existsSync(notesDir)
    ? readdirSync(notesDir).filter((f) => f.endsWith('.md'))
    : [];

  let moved = 0;
  const errors: string[] = [];

  for (const file of files) {
    const src = join(notesDir, file);
    const dest = join(newDir, file);
    try {
      copyFileSync(src, dest);
      unlinkSync(src);
      moved++;
    } catch (e: any) {
      errors.push(`${file}: ${e.message}`);
    }
  }

  notesDir = newDir;
  storageRef?.set({ [STORAGE_KEY]: newDir });
  return { moved, errors };
}

export function readNote(nodeId: string): string | null {
  const filePath = join(notesDir, `${nodeId}.md`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function writeNote(nodeId: string, markdown: string): void {
  initNotesDir();
  writeFileSync(join(notesDir, `${nodeId}.md`), markdown, 'utf-8');
}

export function removeNote(nodeId: string): void {
  const filePath = join(notesDir, `${nodeId}.md`);
  if (existsSync(filePath)) unlinkSync(filePath);
}

export function listNotes(): string[] {
  initNotesDir();
  return readdirSync(notesDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
}

export function noteExists(nodeId: string): boolean {
  return existsSync(join(notesDir, `${nodeId}.md`));
}
