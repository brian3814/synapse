// src/ui/components/artifacts/ArtifactEditor.tsx

import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ArtifactType } from '../../../shared/artifact-types';

interface ArtifactEditorProps {
  content: string;
  onChange: (value: string) => void;
  type: ArtifactType;
}

function getLanguageExtension(type: ArtifactType) {
  switch (type) {
    case 'jsx':
      return javascript({ jsx: true });
    case 'html':
    case 'svg':
      return html();
    case 'markdown':
    case 'mermaid':
      return markdown();
    default:
      return javascript();
  }
}

export function ArtifactEditor({ content, onChange, type }: ArtifactEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        keymap.of(defaultKeymap),
        getLanguageExtension(type),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
          '.cm-content': { padding: '8px 0' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content },
      });
    }
  }, [content]);

  return <div ref={containerRef} className="h-full" />;
}
