const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const PDF_EXTS = new Set(['.pdf']);
const NOTE_EXTS = new Set(['.md']);

export type FileCategory = 'note' | 'image' | 'pdf' | 'external';

export function getFileCategory(filename: string): FileCategory {
  const ext = getExtension(filename);
  if (NOTE_EXTS.has(ext)) return 'note';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (PDF_EXTS.has(ext)) return 'pdf';
  return 'external';
}

export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

export function getFileIcon(filename: string, isFolder: boolean): string {
  if (isFolder) return '📁';
  const cat = getFileCategory(filename);
  switch (cat) {
    case 'note': return '📝';
    case 'image': return '🖼️';
    case 'pdf': return '📄';
    default: return '📎';
  }
}
