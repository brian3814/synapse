import { useLLMStore } from '../../../graph/store/llm-store';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { startExtraction, startQuickExtraction, startAgentExtraction } from '../../extractionActions';
import { TextInput } from './TextInput';
import { PromptInput } from './PromptInput';
import { PrivacyDisclosure } from './PrivacyDisclosure';
import { FetchError } from './ExtractionProgress';
import type { ExtractionTab } from '../../../graph/store/llm-store';

const TABS: { key: ExtractionTab; label: string }[] = [
  { key: 'page', label: 'From Page' },
  { key: 'text', label: 'From Text' },
];

export function LLMPanel({ onClose }: { onClose?: () => void }) {
  const status = useLLMStore((s) => s.status);
  const activeTab = useLLMStore((s) => s.activeTab);
  const setActiveTab = useLLMStore((s) => s.setActiveTab);
  const error = useLLMStore((s) => s.error);
  const showPrivacyModal = useLLMStore((s) => s.showPrivacyModal);
  const pendingAction = useLLMStore((s) => s.pendingAction);
  const resetLLM = useLLMStore((s) => s.reset);
  const resetReview = useExtractionReviewStore((s) => s.reset);
  const extractionMode = useLLMStore((s) => s.extractionMode);
  const reset = () => { resetLLM(); resetReview(); };

  const isIdle = status === 'idle' || status === 'error';

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">LLM Extraction</h3>
        <div className="flex items-center gap-1">
          {status !== 'idle' && (
            <button
              onClick={reset}
              className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
            >
              Reset
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700 transition-colors"
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Tab toggle — only show when idle/error */}
      {isIdle && (
        <div className="flex gap-1 bg-zinc-800 rounded p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                activeTab === tab.key
                  ? 'bg-zinc-600 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {error && <FetchError error={error} />}

      {showPrivacyModal ? (
        <PrivacyDisclosure
          onAccept={() => {
            useLLMStore.getState().setShowPrivacyModal(false);
            pendingAction?.();
          }}
          onCancel={() => {
            useLLMStore.getState().setShowPrivacyModal(false);
          }}
        />
      ) : isIdle && activeTab === 'page' ? (
        <PromptInput onSubmit={(prompt, sourceUrl) => {
          const fn = extractionMode === 'deep' ? startAgentExtraction : startQuickExtraction;
          fn(prompt, sourceUrl);
        }} />
      ) : isIdle && activeTab === 'text' ? (
        <TextInput onSubmit={startExtraction} />
      ) : !isIdle ? (
        <p className="text-xs text-zinc-500">Extraction in progress — check the Review tab.</p>
      ) : null}
    </div>
  );
}
