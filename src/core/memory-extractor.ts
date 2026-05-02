import { llm, storage } from '@platform';
import { memory } from '../db/client/db-client';
import { LLM_CONFIG_STORAGE_KEY, LLM_MODELS } from '../shared/constants';

async function getConfiguredModel(): Promise<string> {
  try {
    const result = await storage.get(LLM_CONFIG_STORAGE_KEY);
    const config = (result as any)[LLM_CONFIG_STORAGE_KEY];
    if (config?.model) return config.model;
  } catch {}
  return LLM_MODELS.anthropic[LLM_MODELS.anthropic.length - 1].id;
}

const MEMORY_EXTRACTION_PROMPT = `You extract facts about the user from a conversation exchange. Return a JSON array of objects with "category" and "content" fields. Categories:
- "preference": how the user likes things done (tone, format, depth, topics of interest)
- "fact": concrete facts about the user (role, expertise, projects, location, etc.)
- "instruction": explicit behavioral directives the user gave ("always do X", "never do Y")

Rules:
- Only extract information explicitly stated or strongly implied by the user's message
- Do NOT extract information from the assistant's response
- Each item should be a self-contained statement (e.g., "User is a data scientist" not "data scientist")
- If nothing is worth remembering, return an empty array []
- Maximum 3 items per exchange
- Return ONLY the JSON array, no other text`;

export async function extractSemanticMemories(
  userMessage: string,
  assistantResponse: string,
  sessionId: string,
): Promise<void> {
  try {
    const requestId = crypto.randomUUID();
    const result = await llm.streamChat(
      {
        requestId,
        model: await getConfiguredModel(),
        systemPrompt: MEMORY_EXTRACTION_PROMPT,
        messages: [
          {
            role: 'user',
            content: `User message:\n${userMessage}\n\nAssistant response:\n${assistantResponse.substring(0, 2000)}`,
          },
        ],
        tools: [],
      },
      () => {},
    );

    const text = result.textContent?.trim();
    if (!text) return;

    let items: Array<{ category: string; content: string }>;
    try {
      items = JSON.parse(text);
    } catch {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) return;

    for (const item of items.slice(0, 3)) {
      if (!item.category || !item.content) continue;
      if (!['preference', 'fact', 'instruction'].includes(item.category)) continue;

      const existing = await memory.findDuplicate(item.content);
      if (existing) {
        await memory.touchSemantic((existing as any).id);
      } else {
        await memory.addSemantic({
          category: item.category,
          content: item.content,
          sourceSessionId: sessionId,
        });
      }
    }
  } catch (e) {
    console.warn('[MemoryExtractor] Extraction failed (non-blocking):', e);
  }
}
