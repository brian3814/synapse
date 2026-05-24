import { createUICommandContext } from '../../commands/create-context';
import {
  retrieveRAGContext as ragRetrieve,
  formatRAGPrompt,
  RAG_SYSTEM_PROMPT,
  type RAGContext,
} from '../../commands/rag-commands';

export type { RAGContext };
export { formatRAGPrompt, RAG_SYSTEM_PROMPT };

export async function retrieveRAGContext(question: string): Promise<RAGContext> {
  const ctx = createUICommandContext();
  return ragRetrieve(ctx, question);
}
