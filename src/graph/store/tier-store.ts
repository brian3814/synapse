import { create } from 'zustand';
import { spatial } from '../../db/client/db-client';
import { buildTierIndex, type TierIndex, type NodeDegree } from '../tier-index';
import { SYNC_CHANNEL, type SyncEvent } from '../../shared/sync-events';

interface TierState {
  tierIndex: TierIndex | null;
  computing: boolean;
}

interface TierActions {
  computeTiers: () => Promise<void>;
  getTier: (nodeId: string) => number;
  startSyncListener: () => () => void;
}

export const useTierStore = create<TierState & TierActions>((set, get) => ({
  tierIndex: null,
  computing: false,

  computeTiers: async () => {
    if (get().computing) return;
    set({ computing: true });
    try {
      const [degreeRows, totalNodeCount] = await Promise.all([
        spatial.nodeDegrees(),
        spatial.totalNodeCount(),
      ]);

      // Map snake_case node_id → camelCase nodeId
      const degrees: NodeDegree[] = degreeRows.map((row) => ({
        nodeId: row.node_id,
        degree: row.degree,
      }));

      // Pad with zero-degree placeholders so percentile bucketing accounts for
      // nodes that have no edges (not returned by nodeDegrees query)
      const zeroCount = totalNodeCount - degrees.length;
      for (let i = 0; i < zeroCount; i++) {
        degrees.push({ nodeId: `__zero_${i}`, degree: 0 });
      }

      const tierIndex = buildTierIndex(degrees);
      set({ tierIndex });
    } finally {
      set({ computing: false });
    }
  },

  getTier: (nodeId: string) => {
    const { tierIndex } = get();
    if (!tierIndex) return 1;
    return tierIndex.tiers.get(nodeId) ?? 1;
  },

  startSyncListener: () => {
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const RELEVANT_EVENTS = new Set<SyncEvent['type']>([
      'edge_created',
      'edge_deleted',
      'node_created',
      'node_deleted',
      'reset',
    ]);

    channel.onmessage = (event: MessageEvent<SyncEvent>) => {
      const syncEvent = event.data;
      if (!RELEVANT_EVENTS.has(syncEvent.type)) return;

      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        get().computeTiers().catch(() => {
          // Swallow errors from background recomputation
        });
      }, 200);
    };

    return () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      channel.close();
    };
  },
}));
