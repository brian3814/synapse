import { useState, useEffect, useCallback } from 'react';
import { storage } from '@platform';
import { getAgentSystemPrompt } from '../../../core/system-prompts';
import { getQuickExtractSystemPrompt } from '../../../shared/quick-extract-prompt';
import { BASE_CHAT_SYSTEM_PROMPT } from '../../../core/prompt-assembler';
import { AGENT_TOOLS } from '../../../shared/agent-tools';
import { CHAT_AGENT_TOOLS } from '../../../shared/chat-agent-tools';
import {
  AGENT_PROMPT_CONFIG_KEY,
  AGENT_TOOL_CONFIG_KEY,
  DEFAULT_CHAT_MAX_ITERATIONS,
} from '../../../shared/agent-settings-types';
import type { AgentPromptConfig, AgentToolConfig } from '../../../shared/agent-settings-types';
import { ToolToggleRow } from './ToolToggleRow';
import { VaultSandboxSection } from './VaultSandboxSection';

const CHAT_TOOL_CATEGORIES: Record<string, { tools: string[]; variant?: 'destructive' }> = {
  Read: {
    tools: ['search_knowledge', 'search_nodes', 'get_node_details', 'get_neighbors', 'get_edges_for_node', 'search_sources', 'get_source_content'],
  },
  Write: {
    tools: ['create_node', 'update_node', 'create_edge', 'index_notes_folder', 'manage_memory'],
  },
  Destructive: {
    tools: ['delete_node', 'merge_nodes'],
    variant: 'destructive',
  },
};

export function AgentSettingsTab() {
  const [promptConfig, setPromptConfig] = useState<AgentPromptConfig>({
    extractionInstructions: '',
    chatInstructions: '',
  });
  const [toolConfig, setToolConfig] = useState<AgentToolConfig>({
    disabledExtractionTools: [],
    disabledChatTools: [],
  });
  const [savedPrompt, setSavedPrompt] = useState(false);
  const [showExtractionPrompt, setShowExtractionPrompt] = useState(false);
  const [showChatPrompt, setShowChatPrompt] = useState(false);

  useEffect(() => {
    storage.get([AGENT_PROMPT_CONFIG_KEY, AGENT_TOOL_CONFIG_KEY]).then((data: Record<string, any>) => {
      if (data[AGENT_PROMPT_CONFIG_KEY]) setPromptConfig(data[AGENT_PROMPT_CONFIG_KEY]);
      if (data[AGENT_TOOL_CONFIG_KEY]) setToolConfig(data[AGENT_TOOL_CONFIG_KEY]);
    }).catch(() => {});
  }, []);

  const savePromptConfig = useCallback(async (updated: AgentPromptConfig) => {
    setPromptConfig(updated);
    await storage.set({ [AGENT_PROMPT_CONFIG_KEY]: updated });
    setSavedPrompt(true);
    setTimeout(() => setSavedPrompt(false), 2000);
  }, []);

  const saveToolConfig = useCallback(async (updated: AgentToolConfig) => {
    setToolConfig(updated);
    await storage.set({ [AGENT_TOOL_CONFIG_KEY]: updated });
  }, []);

  const handleExtractionToolToggle = useCallback((name: string, enabled: boolean) => {
    const updated = {
      ...toolConfig,
      disabledExtractionTools: enabled
        ? toolConfig.disabledExtractionTools.filter((t) => t !== name)
        : [...toolConfig.disabledExtractionTools, name],
    };
    saveToolConfig(updated);
  }, [toolConfig, saveToolConfig]);

  const handleChatToolToggle = useCallback((name: string, enabled: boolean) => {
    const updated = {
      ...toolConfig,
      disabledChatTools: enabled
        ? toolConfig.disabledChatTools.filter((t) => t !== name)
        : [...toolConfig.disabledChatTools, name],
    };
    saveToolConfig(updated);
  }, [toolConfig, saveToolConfig]);

  const allExtractionDisabled = AGENT_TOOLS.filter((t) => t.name !== 'save_entities').every(
    (t) => toolConfig.disabledExtractionTools.includes(t.name)
  );

  const chatReadDisabled = CHAT_TOOL_CATEGORIES.Read.tools.every(
    (t) => toolConfig.disabledChatTools.includes(t)
  );
  const chatWriteDisabled = CHAT_TOOL_CATEGORIES.Write.tools.every(
    (t) => toolConfig.disabledChatTools.includes(t)
  );
  const chatDestructiveDisabled = CHAT_TOOL_CATEGORIES.Destructive.tools.every(
    (t) => toolConfig.disabledChatTools.includes(t)
  );

  return (
    <div className="p-5 space-y-0">
      {/* Extraction Agent */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">Extraction Agent</h3>

        <button
          onClick={() => setShowExtractionPrompt(!showExtractionPrompt)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 mb-2"
        >
          {showExtractionPrompt ? '▼ Hide default prompt' : '▶ View default prompt'}
        </button>
        {showExtractionPrompt && (
          <pre className="text-[10px] text-zinc-500 bg-zinc-800/50 border border-zinc-700 rounded p-2 mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
            {getAgentSystemPrompt(false)}
            {'\n\n---\n\nQuick extract variant:\n\n'}
            {getQuickExtractSystemPrompt(false)}
          </pre>
        )}

        <div className="mb-3">
          <label className="text-[10px] text-zinc-500 block mb-1">Custom Instructions</label>
          <p className="text-[10px] text-zinc-600 mb-1">Appended after the default prompt when extracting from pages or text.</p>
          <textarea
            value={promptConfig.extractionInstructions}
            onChange={(e) => setPromptConfig({ ...promptConfig, extractionInstructions: e.target.value })}
            placeholder="e.g., Always include dates as properties. Focus on technology entities."
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-y"
          />
          <button
            onClick={() => savePromptConfig(promptConfig)}
            className="mt-1.5 w-full bg-indigo-600 text-white text-xs py-1.5 rounded hover:bg-indigo-500 transition-colors"
          >
            {savedPrompt ? 'Saved!' : 'Save Instructions'}
          </button>
        </div>

        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Tools</label>
          {allExtractionDisabled && (
            <p className="text-[10px] text-amber-400 mb-1">All tools disabled — extraction agent can only observe.</p>
          )}
          <div className="space-y-0.5">
            {AGENT_TOOLS.map((tool) => (
              <ToolToggleRow
                key={tool.name}
                name={tool.name}
                description={tool.description.slice(0, 80) + (tool.description.length > 80 ? '…' : '')}
                enabled={!toolConfig.disabledExtractionTools.includes(tool.name)}
                locked={tool.name === 'save_entities'}
                onToggle={handleExtractionToolToggle}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Chat Agent */}
      <div className="border-t border-zinc-700 pt-4 mt-4">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">Chat Agent</h3>

        <button
          onClick={() => setShowChatPrompt(!showChatPrompt)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 mb-2"
        >
          {showChatPrompt ? '▼ Hide default prompt' : '▶ View default prompt'}
        </button>
        {showChatPrompt && (
          <pre className="text-[10px] text-zinc-500 bg-zinc-800/50 border border-zinc-700 rounded p-2 mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
            {BASE_CHAT_SYSTEM_PROMPT}
          </pre>
        )}

        <div className="mb-3">
          <label className="text-[10px] text-zinc-500 block mb-1">Custom Instructions</label>
          <p className="text-[10px] text-zinc-600 mb-1">Appended after the default prompt for every chat session.</p>
          <textarea
            value={promptConfig.chatInstructions}
            onChange={(e) => setPromptConfig({ ...promptConfig, chatInstructions: e.target.value })}
            placeholder="e.g., I'm a researcher in AI safety. Always cite sources. Respond in bullet points."
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-y"
          />
          <button
            onClick={() => savePromptConfig(promptConfig)}
            className="mt-1.5 w-full bg-indigo-600 text-white text-xs py-1.5 rounded hover:bg-indigo-500 transition-colors"
          >
            {savedPrompt ? 'Saved!' : 'Save Instructions'}
          </button>
        </div>

        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Tools</label>
          {chatReadDisabled && (
            <p className="text-[10px] text-amber-400 mb-1">All read tools disabled — agent can't search the graph.</p>
          )}
          {chatWriteDisabled && (
            <p className="text-[10px] text-amber-400 mb-1">All write tools disabled — agent can't modify the graph.</p>
          )}
          {chatDestructiveDisabled && (
            <p className="text-[10px] text-zinc-500 mb-1">Destructive tools disabled.</p>
          )}
          <div className="space-y-2">
            {Object.entries(CHAT_TOOL_CATEGORIES).map(([category, { tools: toolNames, variant }]) => (
              <div key={category}>
                <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">{category}</span>
                <div className="space-y-0.5 mt-0.5">
                  {toolNames.map((name) => {
                    const tool = CHAT_AGENT_TOOLS.find((t) => t.name === name);
                    if (!tool) return null;
                    return (
                      <ToolToggleRow
                        key={name}
                        name={name}
                        description={tool.description.slice(0, 80) + (tool.description.length > 80 ? '…' : '')}
                        enabled={!toolConfig.disabledChatTools.includes(name)}
                        variant={variant}
                        onToggle={handleChatToolToggle}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <label className="text-[10px] text-zinc-500 block mb-1">Max Tool Iterations</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={500}
              value={toolConfig.chatMaxIterations ?? DEFAULT_CHAT_MAX_ITERATIONS}
              onChange={(e) => {
                const val = Math.max(5, Math.min(500, parseInt(e.target.value) || DEFAULT_CHAT_MAX_ITERATIONS));
                saveToolConfig({ ...toolConfig, chatMaxIterations: val });
              }}
              className="w-20 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
            />
            <span className="text-[10px] text-zinc-600">LLM round-trips per request (default {DEFAULT_CHAT_MAX_ITERATIONS})</span>
          </div>
        </div>
      </div>

      {/* Vault Sandbox */}
      <VaultSandboxSection />
    </div>
  );
}
