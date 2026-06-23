import React from 'react';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';

interface NodeTooltipProps {
  node: {
    id: string;
    name: string;
    data?: {
      type?: string;
      properties?: Record<string, unknown>;
      sourceUrl?: string;
    };
  };
}

export function NodeTooltip({ node }: NodeTooltipProps) {
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);
  const type = node.data?.type ?? 'concept';
  const color = getColorForType(type);

  return (
    <div className="bg-zinc-800 border border-zinc-600 rounded-lg p-3 shadow-xl max-w-[250px]">
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="font-medium text-sm text-zinc-100 truncate">
          {node.name}
        </span>
      </div>
      <span className="text-xs text-zinc-400 capitalize">{type}</span>
      {node.data?.sourceUrl && (
        <div className="text-xs text-zinc-500 mt-1 truncate">
          {node.data.sourceUrl}
        </div>
      )}
    </div>
  );
}
