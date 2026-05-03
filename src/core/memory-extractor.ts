import { llm } from '@platform';
import { chat, memory } from '../db/client/db-client';
import { LLM_MODELS } from '../shared/constants';

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
          'Summarize this conversation in 2-3 sentences. Focus on what was discussed, decisions made, and any unresolved questions. Return ONLY the summary text, no JSON.',
        messages: [{ role: 'user', content: transcript }],
        tools: [],
      },
      () => {},
    );

    const summary = result.textContent?.trim();
    if (!summary) return;

    await memory.addEpisodic({
      sessionId,
      summary,
    });
  } catch (e) {
    console.warn('[MemoryExtractor] Session summarization failed (non-blocking):', e);
  }
}
