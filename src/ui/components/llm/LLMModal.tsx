import { useEffect, useRef } from 'react';
import { useUIStore } from '../../../graph/store/ui-store';
import { LLMPanel } from './LLMPanel';

export function LLMModal() {
  const open = useUIStore((s) => s.llmModalOpen);
  const setOpen = useUIStore((s) => s.setLLMModalOpen);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === backdropRef.current) setOpen(false);
      }}
    >
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[520px] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="overflow-y-auto flex-1">
          <LLMPanel onClose={() => setOpen(false)} />
        </div>
      </div>
    </div>
  );
}
