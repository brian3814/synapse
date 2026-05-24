import { useState, useCallback, useRef, useEffect } from 'react';
import { createIngestionSourceFromFile } from '../../../ingestion/ingestion-pipeline';
import { getSupportedExtensions } from '../../../ingestion/processor-factory';
import type { IngestionSource, ProcessingMode } from '../../../ingestion/types';

interface DropZoneProps {
  onIngest: (source: IngestionSource, mode: ProcessingMode) => void;
}

export function DropZone({ onIngest }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      const file = e.dataTransfer?.files?.[0];
      if (!file) return;

      try {
        const source = await createIngestionSourceFromFile(file);
        onIngest(source, 'full');
      } catch (err) {
        console.error('[DropZone] Failed to create ingestion source:', err);
      }
    },
    [onIngest],
  );

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    root.addEventListener('dragenter', handleDragEnter);
    root.addEventListener('dragleave', handleDragLeave);
    root.addEventListener('dragover', handleDragOver);
    root.addEventListener('drop', handleDrop);

    return () => {
      root.removeEventListener('dragenter', handleDragEnter);
      root.removeEventListener('dragleave', handleDragLeave);
      root.removeEventListener('dragover', handleDragOver);
      root.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  if (!isDragging) return null;

  const extensions = getSupportedExtensions().join(', ');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(17, 24, 39, 0.88)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          border: '2px dashed #6366f1',
          borderRadius: '12px',
          padding: '48px 64px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          backgroundColor: 'rgba(99, 102, 241, 0.08)',
        }}
      >
        {/* Upload icon */}
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6366f1"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>

        <p
          style={{
            color: '#e0e0ff',
            fontSize: '18px',
            fontWeight: 600,
            margin: 0,
            textAlign: 'center',
          }}
        >
          Drop file to extract knowledge
        </p>

        <p
          style={{
            color: '#9ca3af',
            fontSize: '13px',
            margin: 0,
            textAlign: 'center',
          }}
        >
          Supported: {extensions}
        </p>
      </div>
    </div>
  );
}
