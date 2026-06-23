import type { ToolModule, ToolExecResult, CommandContext } from './types';
import type { ChatToolDefinition } from '../../shared/chat-agent-tools';
import type { ArtifactType } from '../../shared/artifact-types';
import { ARTIFACT_EXTENSIONS } from '../../shared/artifact-types';
import { executeQuery } from '../../db/worker/query-executor';

const VALID_TYPES = new Set(Object.keys(ARTIFACT_EXTENSIONS));

export const definitions: ChatToolDefinition[] = [
  {
    name: 'create_artifact',
    description:
      'Create a rich artifact (React component, HTML page, SVG, Mermaid diagram, or Markdown document). ' +
      'Artifacts are rendered in a dedicated preview panel and saved to the vault. ' +
      'Use this when the user asks you to build, create, or generate a visual component, diagram, or document.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Human-readable title for the artifact',
        },
        type: {
          type: 'string',
          enum: ['jsx', 'html', 'svg', 'mermaid', 'markdown'],
          description:
            'Artifact type: jsx (React component), html (standalone HTML), svg, mermaid (diagram), or markdown',
        },
        content: {
          type: 'string',
          description: 'The full source content of the artifact',
        },
      },
      required: ['title', 'type', 'content'],
    },
    executionContext: 'ui',
  },
  {
    name: 'update_artifact',
    description:
      'Update an existing artifact with new content. Use when the user asks to modify, fix, or iterate on a previously created artifact.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the artifact to update',
        },
        title: {
          type: 'string',
          description: 'Updated title (optional — keeps current title if omitted)',
        },
        content: {
          type: 'string',
          description: 'The full updated source content',
        },
      },
      required: ['id', 'content'],
    },
    executionContext: 'ui',
  },
];

async function getActiveSession(): Promise<{ id: string; title: string; createdAt: string }> {
  const { rows } = await executeQuery<{ id: string; title: string; created_at: string }>(
    `SELECT id, title, created_at FROM chat_sessions
     WHERE status = 'active'
     ORDER BY last_active_at DESC LIMIT 1`,
  );
  const session = rows[0];
  return {
    id: session?.id ?? '',
    title: session?.title ?? 'Untitled',
    createdAt: session?.created_at ?? new Date().toISOString(),
  };
}

async function execute(
  ctx: CommandContext,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolExecResult | null> {
  if (name !== 'create_artifact' && name !== 'update_artifact') return null;

  if (!ctx.artifacts) {
    return { result: JSON.stringify({ error: 'Artifacts are not available in this environment' }) };
  }

  switch (name) {
    case 'create_artifact': {
      const title = input.title as string;
      const type = input.type as string;
      const content = input.content as string;

      if (!title || !type || !content) {
        return { result: JSON.stringify({ error: 'Missing required fields: title, type, content' }) };
      }
      if (!VALID_TYPES.has(type)) {
        return {
          result: JSON.stringify({
            error: `Invalid artifact type: ${type}. Valid types: ${[...VALID_TYPES].join(', ')}`,
          }),
        };
      }

      const session = await getActiveSession();

      const record = await ctx.artifacts.create({
        title,
        type: type as ArtifactType,
        content,
        sessionId: session.id,
        sessionTitle: session.title,
        sessionCreatedAt: session.createdAt,
      });

      return {
        result: JSON.stringify({
          id: record.id,
          title: record.title,
          type: record.type,
          fileName: record.fileName,
          sessionDir: record.sessionDir,
          created: true,
        }),
      };
    }

    case 'update_artifact': {
      const id = input.id as string;
      const content = input.content as string;
      const title = input.title as string | undefined;

      if (!id || !content) {
        return { result: JSON.stringify({ error: 'Missing required fields: id, content' }) };
      }

      const existing = await ctx.artifacts.get(id);
      if (!existing) {
        return { result: JSON.stringify({ error: `Artifact ${id} not found` }) };
      }

      const record = await ctx.artifacts.update(id, content, title);

      return {
        result: JSON.stringify({
          id: record.id,
          title: record.title,
          type: record.type,
          fileName: record.fileName,
          updated: true,
        }),
      };
    }

    default:
      return null;
  }
}

export const artifactTools: ToolModule = { definitions, execute };
