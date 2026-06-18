import { MODEL_PRICING } from './constants';

/**
 * Estimate extraction cost before making the API call.
 * Uses chars/4 heuristic for input tokens + conservative output estimates.
 */
export function estimateExtractionCost(params: {
  mode: 'simple' | 'agent';
  inputChars: number;
  model: string;
}): { cents: number; label: string } {
  const pricing = MODEL_PRICING[params.model] ?? MODEL_PRICING['claude-sonnet-4-6'];
  const inputTokens = Math.ceil(params.inputChars / 4);

  let totalInput: number;
  let totalOutput: number;

  if (params.mode === 'simple') {
    // Single API call
    totalInput = inputTokens;
    totalOutput = 2000;
  } else {
    // Agent mode: ~3 iterations avg, context grows per iteration
    totalInput = Math.round(inputTokens * 4);
    totalOutput = 6000;
  }

  const cents = ((totalInput * pricing.inputPer1M + totalOutput * pricing.outputPer1M) / 1_000_000) * 100;

  if (params.mode === 'agent') {
    return { cents, label: `up to ~${formatCents(cents)}` };
  }
  return { cents, label: `~${formatCents(cents)}` };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents < 1 ? 4 : 3)}`;
}
