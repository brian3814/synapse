import React, { useCallback, useRef, useState } from 'react';

interface ColumnResizeHandleProps {
  leftColumnId: string;
  rightColumnId: string;
  leftFlex: number;
  rightFlex: number;
  totalFlex: number;
  containerRef: React.RefObject<HTMLElement | null>;
  onResize: (leftColumnId: string, leftFlex: number, rightColumnId: string, rightFlex: number) => void;
}

export function ColumnResizeHandle({
  leftColumnId,
  rightColumnId,
  leftFlex,
  rightFlex,
  totalFlex,
  containerRef,
  onResize,
}: ColumnResizeHandleProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startLeft = useRef(leftFlex);
  const startRight = useRef(rightFlex);
  const [active, setActive] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startLeft.current = leftFlex;
    startRight.current = rightFlex;
    setActive(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [leftFlex, rightFlex]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const containerPx = containerRef.current.clientWidth;
    const pxPerFlex = containerPx / totalFlex;
    const deltaPx = e.clientX - startX.current;
    const deltaFlex = deltaPx / pxPerFlex;
    const newLeft = startLeft.current + deltaFlex;
    const newRight = startRight.current - deltaFlex;
    if (newLeft >= 0.15 && newRight >= 0.15) {
      onResize(leftColumnId, newLeft, rightColumnId, newRight);
    }
  }, [leftColumnId, rightColumnId, totalFlex, containerRef, onResize]);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    setActive(false);
  }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`shrink-0 flex items-center justify-center cursor-col-resize transition-colors group ${
        active
          ? 'w-1.5 bg-indigo-500'
          : 'w-1.5 bg-zinc-600 hover:bg-indigo-500/70'
      }`}
    >
      <div className={`flex flex-col gap-[3px] transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <div className="w-[3px] h-[3px] rounded-full bg-zinc-300" />
        <div className="w-[3px] h-[3px] rounded-full bg-zinc-300" />
        <div className="w-[3px] h-[3px] rounded-full bg-zinc-300" />
      </div>
    </div>
  );
}
