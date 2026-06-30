import React, { useMemo, useState } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import {
  labelPropagation,
  findConnectionSuggestions,
  detectPatterns,
  degreeCentrality,
  connectedComponents,
  findOrphans,
  findBridgeNodes,
  computeGraphHealth,
  type Cluster,
  type ConnectionSuggestion,
  type PatternInsight,
  type GraphHealthMetrics,
  type BridgeNode,
} from '../../../graph/algorithms/graph-algorithms';
import { PanelHeader } from '../shared/PanelHeader';

export function IntelligencePanel() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const adjacency = useGraphStore((s) => s.adjacency);
  const selectNode = useGraphStore((s) => s.selectNode);

  const analysis = useMemo(() => {
    if (nodes.length < 3) return null;

    const clusters = labelPropagation(adjacency, nodes);
    const suggestions = findConnectionSuggestions(adjacency, nodes);
    const patterns = detectPatterns(nodes, edges, adjacency);
    const centrality = degreeCentrality(adjacency, nodes);

    const centralNodes = [...centrality.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .filter(([, score]) => score > 0);

    const components = connectedComponents(adjacency, nodes);
    const health = computeGraphHealth(nodes, edges, adjacency, clusters, components);
    const orphans = findOrphans(adjacency, nodes);
    const bridges = findBridgeNodes(adjacency, nodes, clusters);

    return { clusters, suggestions, patterns, centralNodes, health, orphans, bridges };
  }, [nodes, edges, adjacency]);

  const handleNodeClick = (nodeId: string) => {
    const { openContentTab, setGraphOverlay, focusNodeCallback } = useUIStore.getState();
    openContentTab({ kind: 'graph' }, 'Graph');
    selectNode(nodeId);
    setGraphOverlay('nodeDetail');
    if (focusNodeCallback) focusNodeCallback(nodeId);
  };

  if (nodes.length < 3) {
    return (
      <div className="p-4 space-y-4">
        <PanelHeader title="Intelligence" />
        <div className="text-center py-8">
          <p className="text-sm text-zinc-500">Need more data</p>
          <p className="text-xs text-zinc-600 mt-1">
            Add at least 3 nodes and some edges to see graph intelligence.
          </p>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="p-4 space-y-5 text-sm">
      <h3 className="text-sm font-semibold text-zinc-100">Intelligence</h3>

      {/* Health Card */}
      <HealthCard health={analysis.health} />

      {/* Patterns / Insights */}
      {analysis.patterns.length > 0 && (
        <Section title="Insights">
          {analysis.patterns.map((pattern, i) => (
            <PatternCard key={i} pattern={pattern} onNodeClick={handleNodeClick} />
          ))}
        </Section>
      )}

      {/* Clusters */}
      {analysis.clusters.length > 0 && (
        <Section title={`Knowledge Clusters (${analysis.clusters.length})`}>
          {analysis.clusters.slice(0, 8).map((cluster) => (
            <ClusterCard key={cluster.id} cluster={cluster} onNodeClick={handleNodeClick} />
          ))}
        </Section>
      )}

      {/* Central entities */}
      {analysis.centralNodes.length > 0 && (
        <Section title="Central Entities">
          <div className="space-y-1">
            {analysis.centralNodes.map(([nodeId, score]) => {
              const node = nodes.find((n) => n.id === nodeId);
              if (!node) return null;
              const degree = adjacency.get(nodeId)?.length ?? 0;
              return (
                <button
                  key={nodeId}
                  onClick={() => handleNodeClick(nodeId)}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-700/50 transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: node.color ?? '#6B7280' }}
                  />
                  <span className="text-xs text-zinc-300 truncate">{node.name}</span>
                  <span className="text-[10px] text-zinc-500 ml-1">{(score * 100).toFixed(0)}%</span>
                  <span className="text-[10px] text-zinc-600 ml-auto">{degree} connections</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* Bridge Nodes */}
      <BridgeSection bridges={analysis.bridges} nodes={nodes} onNodeClick={handleNodeClick} />

      {/* Orphan Nodes */}
      <OrphanSection orphans={analysis.orphans} onNodeClick={handleNodeClick} />

      {/* Connection suggestions */}
      {analysis.suggestions.length > 0 && (
        <Section title="Potential Connections">
          {analysis.suggestions.slice(0, 5).map((suggestion, i) => (
            <SuggestionCard
              key={i}
              suggestion={suggestion}
              nodes={nodes}
              onNodeClick={handleNodeClick}
            />
          ))}
        </Section>
      )}

      {analysis.clusters.length === 0 && analysis.suggestions.length === 0 && analysis.patterns.length === 0 && (
        <p className="text-xs text-zinc-500 text-center py-4">
          No notable patterns detected yet. Keep building your graph!
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wide">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function PatternCard({ pattern, onNodeClick }: { pattern: PatternInsight; onNodeClick: (id: string) => void }) {
  const icon = pattern.type === 'hub_node' ? '🔗' :
    pattern.type === 'recent_topic' ? '📈' : '🏝️';

  return (
    <div className="px-3 py-2 bg-zinc-800/70 rounded border border-zinc-700/50">
      <p className="text-xs text-zinc-300">
        <span className="mr-1.5">{icon}</span>
        <span className="font-medium text-zinc-200">{pattern.title}:</span>{' '}
        {pattern.description}
      </p>
    </div>
  );
}

function ClusterCard({ cluster, onNodeClick }: { cluster: Cluster; onNodeClick: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const nodes = useGraphStore((s) => s.nodes);
  const clusterNodes = cluster.nodeIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean);

  return (
    <div className="px-3 py-2 bg-zinc-800/70 rounded border border-zinc-700/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left flex items-center justify-between"
      >
        <span className="text-xs text-zinc-200 font-medium truncate">{cluster.label}</span>
        <span className="text-[10px] text-zinc-500 shrink-0 ml-2">{cluster.size} nodes</span>
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {clusterNodes.slice(0, 12).map((node) => (
            <button
              key={node!.id}
              onClick={() => onNodeClick(node!.id)}
              className="text-[10px] px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors"
            >
              {node!.name}
            </button>
          ))}
          {clusterNodes.length > 12 && (
            <span className="text-[10px] text-zinc-600 px-1.5 py-0.5">
              +{clusterNodes.length - 12} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  nodes,
  onNodeClick,
}: {
  suggestion: ConnectionSuggestion;
  nodes: ReturnType<typeof useGraphStore.getState>['nodes'];
  onNodeClick: (id: string) => void;
}) {
  const nodeA = nodes.find((n) => n.id === suggestion.nodeA);
  const nodeB = nodes.find((n) => n.id === suggestion.nodeB);
  if (!nodeA || !nodeB) return null;

  const sharedLabels = suggestion.sharedNeighbors
    .map((id) => nodes.find((n) => n.id === id)?.name ?? '?')
    .slice(0, 3);

  return (
    <div className="px-3 py-2 bg-zinc-800/70 rounded border border-zinc-700/50">
      <p className="text-xs text-zinc-300">
        <button onClick={() => onNodeClick(suggestion.nodeA)} className="text-indigo-400 hover:text-indigo-300">
          {nodeA.name}
        </button>
        {' and '}
        <button onClick={() => onNodeClick(suggestion.nodeB)} className="text-indigo-400 hover:text-indigo-300">
          {nodeB.name}
        </button>
        {' share '}
        <span className="text-zinc-200 font-medium">{suggestion.sharedNeighbors.length}</span>
        {' neighbors'}
      </p>
      <p className="text-[10px] text-zinc-500 mt-0.5">
        via {sharedLabels.join(', ')}{suggestion.sharedNeighbors.length > 3 ? '...' : ''}
      </p>
    </div>
  );
}

function HealthCard({ health }: { health: GraphHealthMetrics }) {
  const metrics = [
    { label: 'Nodes', value: health.nodeCount },
    { label: 'Edges', value: health.edgeCount },
    { label: 'Orphan Rate', value: `${Math.round(health.orphanRate * 100)}%` },
    { label: 'Avg Degree', value: health.avgDegree.toFixed(1) },
    { label: 'Clusters', value: health.clusterCount },
    { label: 'Density', value: health.density.toFixed(4) },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {metrics.map(m => (
        <div key={m.label} className="px-2 py-1.5 bg-zinc-800/70 rounded border border-zinc-700/50 text-center">
          <p className="text-xs font-medium text-zinc-200">{m.value}</p>
          <p className="text-[10px] text-zinc-500">{m.label}</p>
        </div>
      ))}
    </div>
  );
}

function OrphanSection({ orphans, onNodeClick }: { orphans: ReturnType<typeof findOrphans>; onNodeClick: (id: string) => void }) {
  if (orphans.length === 0) return null;
  return (
    <Section title={`Orphan Nodes (${orphans.length})`}>
      <div className="space-y-1">
        {orphans.slice(0, 10).map(node => (
          <button
            key={node.id}
            onClick={() => onNodeClick(node.id)}
            className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-700/50 transition-colors"
          >
            <span className="w-2 h-2 rounded-full shrink-0 bg-amber-500/60" />
            <span className="text-xs text-zinc-300 truncate">{node.name}</span>
            <span className="text-[10px] text-zinc-600 ml-auto">{node.label ?? node.type}</span>
          </button>
        ))}
        {orphans.length > 10 && (
          <p className="text-[10px] text-zinc-600 px-2">+{orphans.length - 10} more</p>
        )}
      </div>
    </Section>
  );
}

function BridgeSection({
  bridges,
  nodes,
  onNodeClick,
}: {
  bridges: BridgeNode[];
  nodes: ReturnType<typeof useGraphStore.getState>['nodes'];
  onNodeClick: (id: string) => void;
}) {
  if (bridges.length === 0) return null;
  return (
    <Section title={`Bridge Nodes (${bridges.length})`}>
      <div className="space-y-1">
        {bridges.slice(0, 8).map(bridge => {
          const node = nodes.find(n => n.id === bridge.nodeId);
          if (!node) return null;
          return (
            <button
              key={bridge.nodeId}
              onClick={() => onNodeClick(bridge.nodeId)}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-700/50 transition-colors"
            >
              <span className="w-2 h-2 rounded-full shrink-0 bg-purple-500/60" />
              <span className="text-xs text-zinc-300 truncate">{node.name}</span>
              <span className="text-[10px] text-zinc-600 ml-auto">
                bridges {bridge.clustersConnected.length} clusters
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
