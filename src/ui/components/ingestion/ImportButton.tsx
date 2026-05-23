import { useRef, useCallback } from 'react';
import { createIngestionSourceFromFile } from '../../../ingestion/ingestion-pipeline';
import {
  getSupportedExtensions,
  getSupportedMimeTypes,
} from '../../../ingestion/processor-factory';
import type { IngestionSource, ProcessingMode } from '../../../ingestion/types';

interface ImportButtonProps {
  onIngest: (source: IngestionSource, mode: ProcessingMode) => void;
}

export function ImportButton({ onIngest }: ImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptAttr = [
    ...getSupportedMimeTypes(),
    ...getSupportedExtensions(),
  ].join(',');

  const handleButtonClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = '';
      if (!file) return;

      try {
        const source = await createIngestionSourceFromFile(file);
        onIngest(source, 'full');
      } catch (err) {
        console.error('[ImportButton] Failed to create ingestion source:', err);
      }
    },
    [onIngest],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={acceptAttr}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <button
        onClick={handleButtonClick}
        title="Import file"
        className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
      >
        <UploadIcon />
      </button>
    </>
  );
}

const UploadIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
