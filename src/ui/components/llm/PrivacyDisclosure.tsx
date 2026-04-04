import React, { useState } from 'react';

interface PrivacyDisclosureProps {
  onAccept: () => void;
  onCancel: () => void;
}

export function PrivacyDisclosure({ onAccept, onCancel }: PrivacyDisclosureProps) {
  const [understood, setUnderstood] = useState(false);

  const handleAccept = async () => {
    try {
      await chrome.storage.local.set({ privacyDisclosureAccepted: true });
    } catch {}
    onAccept();
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-zinc-100">Data Processing Notice</h4>

      <div className="bg-zinc-800 rounded-lg p-3 space-y-2 text-xs text-zinc-300">
        <p>
          When you extract from a page or use chat, the page content or your query is sent to{' '}
          <strong className="text-zinc-100">Anthropic's API</strong> for processing.
        </p>
        <p>
          <strong className="text-zinc-100">What leaves your browser:</strong> Page text, your prompts, and extracted entities (sent to Anthropic for processing).
        </p>
        <p>
          <strong className="text-zinc-100">What stays local:</strong> Your knowledge graph, API key, and all stored data remain in your browser's local storage.
        </p>
        <p className="text-zinc-500">
          Anthropic's API does not use your data for model training.{' '}
          <a
            href="https://www.anthropic.com/policies/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300"
          >
            Privacy Policy
          </a>
        </p>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0"
        />
        <span className="text-xs text-zinc-300">I understand what data is sent externally</span>
      </label>

      <div className="flex gap-2">
        <button
          onClick={handleAccept}
          disabled={!understood}
          className="flex-1 bg-indigo-600 text-white text-sm py-1.5 rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
        <button
          onClick={onCancel}
          className="px-4 bg-zinc-700 text-zinc-300 text-sm py-1.5 rounded hover:bg-zinc-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
