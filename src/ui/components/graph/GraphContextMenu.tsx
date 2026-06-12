import React, { useEffect, useRef } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useChatContextStore } from '../../../graph/store/chat-context-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { useUIStore } from '../../../graph/store/ui-store';
import type { AttachedNode } from '../../../graph/store/chat-context-store';

interface GraphContextMenuProps {
  screenX: number;
  screenY: number;
  nodeId: string | null;
  onClose: () => void;
}

export function GraphContextMenu({ screenX, screenY, nodeId, onClose }: GraphContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);
  const addNodes = useChatContextStore((s) => s.addNodes);
  const setChatOpen = useUIStore((s) => s.setChatOpen);

  // Determine which nodes to send: if right-clicked node is in selection, send selection.
  // Otherwise send just the right-clicked node.
  const targetNodeIds = nodeId && selectedNodeIds.has(nodeId)
    ? selectedNodeIds
    : nodeId
      ? new Set([nodeId])
      : selectedNodeIds;

  const targetCount = targetNodeIds.size;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: screenX,
    top: screenY,
    zIndex: 100,
  };

  const handleSendToChat = () => {
    const attached: AttachedNode[] = [];
    for (const id of targetNodeIds) {
      const node = nodes.find((n) => n.id === id);
      if (node) {
        attached.push({
          id: node.id,
          name: node.name,
          type: node.type,
          color: node.color ?? getColorForType(node.type),
        });
      }
    }
    addNodes(attached);
    setChatOpen(true);
    onClose();
  };

  return (
    <div ref={menuRef} style={style}>
      <div className="bg-zinc-800 border border-zinc-600 rounded-md shadow-xl min-w-[180px] py-1 text-sm">
        {targetCount > 0 && (
          <button
            onClick={handleSendToChat}
            className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700 flex items-center justify-between"
          >
            <span>Send to Chat</span>
            <span className="text-zinc-500 text-xs">{targetCount} {targetCount === 1 ? 'node' : 'nodes'}</span>
          </button>
        )}
        {targetCount === 0 && (
          <div className="px-3 py-1.5 text-zinc-500">No nodes selected</div>
        )}
      </div>
    </div>
  );
}
