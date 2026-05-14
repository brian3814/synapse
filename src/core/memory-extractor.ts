import { llm } from '@platform';
import { chat } from '../db/client/db-client';
import { LLM_MODELS } from '../shared/constants';
import { writeMemory } from '../commands/memory-commands';
import { createUICommandContext } from '../commands/create-context';

export async function summarizeSession(sessionId: string): Promise<void> {
  try {
    const messages = await chat.getRecentMessages(sessionId, 20);
    if (!messages || (messages as any[]).length < 4) return;

    const transcript = (messages as any[])
      .map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 500)}`)
      .join('\n\n');

    const requestId = crypto.randomUUID();
    const result = await llm.streamChat(
      {
        requestId,
        model: LLM_MODELS.anthropic[LLM_MODELS.anthropic.length - 1].id,
        systemPrompt:
          'Summarize this conversation. Return ONLY valid JSON, no other text:\n{\n  "summary": "2-3 sentence summary focusing on decisions and outcomes",\n  "tags": ["3-5 retrieval keywords"],\n  "slug": "short-kebab-case-identifier"\n}',
        messages: [{ role: 'user', content: transcript }],
        tools: [],
      },
      () => {},
    );

    const text = result.textContent?.trim();
    if (!text) return;

    let parsed: { summary: string; tags: string[]; slug: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { summary: text, tags: [], slug: sessionId.slice(0, 20) };
    }

    const date = new Date().toISOString().slice(0, 10);
    const slug = parsed.slug.replace(/[^a-z0-9-]/g, '').slice(0, 40) || sessionId.slice(0, 12);

    const ctx = createUICommandContext();
    await writeMemory(ctx, {
      action: 'create',
      type: 'episodic',
      name: `${date}-${slug}`,
      description: parsed.summary.slice(0, 100),
      content: parsed.summary,
      tags: parsed.tags,
    });
  } catch (e) {
    console.warn('[MemoryExtractor] Session summarization failed (non-blocking):', e);
  }
}
