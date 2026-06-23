import { create } from 'zustand';
import { nodeTypes as dbNodeTypes } from '../../db/client/db-client';
import { TYPE_COLOR_PALETTE, FALLBACK_TYPE_COLOR } from '../../shared/constants';
import type { NodeType } from '../../shared/types';

interface NodeTypeStore {
  types: NodeType[];
  loading: boolean;

  loadTypes: () => Promise<void>;
  createType: (input: {
    type: string;
    description?: string;
    color?: string;
    category?: 'structural' | 'entity_label';
  }) => Promise<NodeType | null>;

  /**
   * Resolves a color for a node given its structural type and (optional) semantic label.
   * For entities, the label's color takes priority; for resource/note, the structural type color is used.
   */
  getColorForNode: (type: string, label?: string | null) => string;

  /** Legacy color lookup by a single key (structural type or label). */
  getColorForType: (typeOrLabel: string) => string;

  /** Returns only the user-extensible entity labels (excludes structural types). */
  getEntityLabels: () => NodeType[];

  /** Returns only the fixed structural types (resource, entity, note). */
  getStructuralTypes: () => NodeType[];
}

export const useNodeTypeStore = create<NodeTypeStore>((set, get) => ({
  types: [],
  loading: false,

  loadTypes: async () => {
    set({ loading: true });
    try {
      const types = await dbNodeTypes.getAll();
      set({ types, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createType: async (input) => {
    try {
      const color = input.color ?? nextPaletteColor(get().types);
      const created = await dbNodeTypes.create({
        ...input,
        color,
        category: input.category ?? 'entity_label',
      });
      set((state) => ({ types: [...state.types, created] }));
      return created;
    } catch {
      return null;
    }
  },

  getColorForNode: (type, label) => {
    const types = get().types;
    // Entities use the label for color (e.g., 'person', 'technology')
    if (type === 'entity' && label) {
      const labelRow = types.find((t) => t.type === label && t.category === 'entity_label');
      if (labelRow?.color) return labelRow.color;
    }
    const typeRow = types.find((t) => t.type === type);
    return typeRow?.color ?? FALLBACK_TYPE_COLOR;
  },

  getColorForType: (typeOrLabel) => {
    const found = get().types.find((t) => t.type === typeOrLabel);
    return found?.color ?? FALLBACK_TYPE_COLOR;
  },

  getEntityLabels: () =>
    get().types.filter((t) => t.category === 'entity_label'),

  getStructuralTypes: () =>
    get().types.filter((t) => t.category === 'structural'),
}));

function nextPaletteColor(existing: NodeType[]): string {
  const usedColors = new Set(existing.map((t) => t.color));
  for (const color of TYPE_COLOR_PALETTE) {
    if (!usedColors.has(color)) return color;
  }
  // All palette colors used — cycle
  return TYPE_COLOR_PALETTE[existing.length % TYPE_COLOR_PALETTE.length];
}
