// src/shared/artifact-types.ts

export type ArtifactType = 'jsx' | 'markdown' | 'html' | 'svg' | 'mermaid';

export const ARTIFACT_EXTENSIONS: Record<ArtifactType, string> = {
  jsx: '.jsx',
  markdown: '.md',
  html: '.html',
  svg: '.svg',
  mermaid: '.mmd',
};

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  jsx: 'React Component',
  markdown: 'Markdown',
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid Diagram',
};

export interface ArtifactMeta {
  id: string;
  title: string;
  type: ArtifactType;
  sessionId: string;
  sessionDir: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord extends ArtifactMeta {
  fileName: string;
}

export function slugify(text: string, maxLength = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/, '');
}
