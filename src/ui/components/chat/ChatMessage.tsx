import React, { useState } from 'react';
import type { ChatMessage as ChatMessageType } from '../../hooks/useChatSession';
import { ChatToolCall } from './ChatToolCall';
import { ChatReferencedEntities } from './ChatReferencedEntities';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { ArtifactCard } from './ArtifactCard';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';

function isArtifactResult(content: string): boolean {
  try {
    const data = JSON.parse(content);
    return data._artifactCard === true;
  } catch {
    return false;
  }
}

interface ChatMessageProps {
  message: ChatMessageType;
  onNodeClick?: (nodeId: string) => void;
}

export function ChatMessage({ message, onNodeClick }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" style={{ marginBottom: '0.75rem' }}>
        <div className="group relative max-w-[85%] bg-indigo-600/20 border border-indigo-500/30 text-zinc-200 text-sm px-3 py-2 rounded-lg">
          {message.attachedContext && message.attachedContext.nodeIds.length > 0 && (
            <AttachedContextChips
              nodeIds={message.attachedContext.nodeIds}
              onNodeClick={onNodeClick}
            />
          )}
          <MarkdownRenderer content={message.content} onNodeClick={onNodeClick} />
          <CopyButton text={message.content} position="bottom-1 right-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start" style={{ marginBottom: '0.75rem' }}>
      <div className="max-w-[95%] space-y-2">
        {message.status === 'streaming' && (
          <div className="group relative bg-zinc-800 border border-zinc-700 text-sm px-3 py-2 rounded-lg">
            {message.agentTurns && message.agentTurns.length > 0 && (
              <div className="space-y-1 mb-2">
                {message.agentTurns.map((turn, i) => (
                  <ChatToolCall key={i} turn={turn} />
                ))}
              </div>
            )}
            {message.agentTurns?.filter(turn =>
              turn.type === 'tool_result' && !turn.isError && isArtifactResult(turn.content)
            ).map((turn, i) => {
              const data = JSON.parse(turn.content);
              return (
                <ArtifactCard
                  key={`artifact-${i}`}
                  artifactId={data.artifactId}
                  title={data.title}
                  type={data.type}
                />
              );
            })}
            <MarkdownRenderer content={message.content || '...'} onNodeClick={onNodeClick} />
            <span className="inline-block w-1.5 h-3.5 bg-indigo-400 animate-pulse ml-0.5" />
            <CopyButton text={message.content} position="bottom-1 left-1" />
          </div>
        )}

        {message.status === 'executing' && (
          <div className="bg-zinc-800 border border-zinc-700 text-sm px-3 py-2 rounded-lg">
            {message.agentTurns && message.agentTurns.length > 0 && (
              <div className="space-y-1 mb-2">
                {message.agentTurns.map((turn, i) => (
                  <ChatToolCall key={i} turn={turn} />
                ))}
              </div>
            )}
            {message.agentTurns?.filter(turn =>
              turn.type === 'tool_result' && !turn.isError && isArtifactResult(turn.content)
            ).map((turn, i) => {
              const data = JSON.parse(turn.content);
              return (
                <ArtifactCard
                  key={`artifact-${i}`}
                  artifactId={data.artifactId}
                  title={data.title}
                  type={data.type}
                />
              );
            })}
            <p className="text-zinc-400 text-xs">Thinking...</p>
          </div>
        )}

        {message.status === 'complete' && (
          <div className="group relative bg-zinc-800 border border-zinc-700 text-sm px-3 py-2 rounded-lg space-y-2">
            {message.agentTurns && message.agentTurns.length > 0 && (
              <div className="space-y-1 mb-2">
                {message.agentTurns.map((turn, i) => (
                  <ChatToolCall key={i} turn={turn} />
                ))}
              </div>
            )}
            {message.agentTurns?.filter(turn =>
              turn.type === 'tool_result' && !turn.isError && isArtifactResult(turn.content)
            ).map((turn, i) => {
              const data = JSON.parse(turn.content);
              return (
                <ArtifactCard
                  key={`artifact-${i}`}
                  artifactId={data.artifactId}
                  title={data.title}
                  type={data.type}
                />
              );
            })}
            <MarkdownRenderer content={message.content} onNodeClick={onNodeClick} />
            {message.subgraph && message.subgraph.nodeIds.length > 0 && (
              <ChatReferencedEntities subgraph={message.subgraph} onNodeClick={onNodeClick} />
            )}
            <CopyButton text={message.content} position="bottom-1 left-1" />
          </div>
        )}

        {message.status === 'error' && (
          <div className="bg-zinc-800 border border-red-500/30 text-sm px-3 py-2 rounded-lg">
            <p className="text-red-400 text-xs">{message.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AttachedContextChips({
  nodeIds,
  onNodeClick,
}: {
  nodeIds: string[];
  onNodeClick?: (nodeId: string) => void;
}) {
  const nodes = useGraphStore((s) => s.nodes);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);

  const resolved = nodeIds.map((id) => {
    const node = nodes.find((n) => n.id === id);
    return node
      ? { id, name: node.name, type: node.type, color: node.color ?? getColorForType(node.type), exists: true }
      : { id, name: id.slice(0, 8), type: '', color: '#666', exists: false };
  });

  return (
    <div className="flex flex-wrap gap-1 mb-1.5">
      {resolved.map((node) => (
        <button
          key={node.id}
          onClick={() => node.exists && onNodeClick?.(node.id)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
            node.exists ? 'cursor-pointer hover:brightness-125' : 'opacity-50 cursor-default'
          }`}
          style={{
            backgroundColor: node.color + '20',
            borderColor: node.color + '33',
            color: node.color + 'cc',
            border: '1px solid',
          }}
          title={node.exists ? `${node.type}: ${node.name}` : 'Node no longer exists'}
        >
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: node.color }}
          />
          <span className="truncate" style={{ maxWidth: '80px' }}>{node.name}</span>
        </button>
      ))}
    </div>
  );
}

function CopyButton({ text, position }: { text: string; position: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className={`absolute ${position} opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-400 hover:text-zinc-200`}
      title="Copy"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}


