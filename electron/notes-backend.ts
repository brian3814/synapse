import { app } from 'electron';
import { join } from 'path';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from 'fs';

const NOTES_DIR = join(app.getPath('userData'), 'notes');

export function initNotesDir(): void {
  if (!existsSync(NOTES_DIR)) mkdirSync(NOTES_DIR, { recursive: true });
}

export function readNote(nodeId: string): string | null {
  const filePath = join(NOTES_DIR, `${nodeId}.md`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function writeNote(nodeId: string, markdown: string): void {
  initNotesDir();
  writeFileSync(join(NOTES_DIR, `${nodeId}.md`), markdown, 'utf-8');
}

export function removeNote(nodeId: string): void {
  const filePath = join(NOTES_DIR, `${nodeId}.md`);
  if (existsSync(filePath)) unlinkSync(filePath);
}

export function listNotes(): string[] {
  initNotesDir();
  return readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
}

export function noteExists(nodeId: string): boolean {
  return existsSync(join(NOTES_DIR, `${nodeId}.md`));
}
