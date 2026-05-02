import React from 'react';
import { useUIStore } from '../../graph/store/ui-store';
import { NodeDetailPanel } from './panels/NodeDetailPanel';
import { EdgeDetailPanel } from './panels/EdgeDetailPanel';
import { CreatePanel } from './panels/CreatePanel';
import { QueryPanel } from './query/QueryPanel';
import { LLMPanel } from './llm/LLMPanel';
import { NotesPanel } from './notes/NotesPanel';
import { IntelligencePanel } from './intelligence/IntelligencePanel';
import { ReadingListPanel } from './reading-list/ReadingListPanel';

export function ActivePanel() {
  const activePanel = useUIStore((s) => s.activePanel);

  switch (activePanel) {
    case 'nodeDetail':
      return <NodeDetailPanel />;
    case 'edgeDetail':
      return <EdgeDetailPanel />;
    case 'create':
      return <CreatePanel />;
    case 'query':
      return <QueryPanel />;
    case 'llm':
      return <LLMPanel />;
    case 'notes':
      return <NotesPanel />;
    case 'intelligence':
      return <IntelligencePanel />;
    case 'readingList':
      return <ReadingListPanel />;
    default:
      return null;
  }
}
