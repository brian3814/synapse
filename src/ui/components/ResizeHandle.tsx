import React, { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  onResize: (delta: number) => void;
}

export function ResizeHandle({ onResize }: ResizeHandleProps) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = lastX.current - e.clientX;
    lastX.current = e.clientX;
    onResize(delta);
  }, [onResize]);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="w-1 shrink-0 cursor-col-resize bg-zinc-700 hover:bg-indigo-500 active:bg-indigo-400 transition-colors"
    />
  );
}
