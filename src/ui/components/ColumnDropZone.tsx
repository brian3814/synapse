import { useDroppable, useDragOperation } from '@dnd-kit/react';

interface ColumnDropZoneProps {
  id: string;
  columnIndex: number;
}

export function ColumnDropZone({ id, columnIndex }: ColumnDropZoneProps) {
  const { source } = useDragOperation();
  const isDragActive = source != null;

  const { ref, isDropTarget } = useDroppable({
    id,
    type: 'column-gap',
    accept: 'tab',
    data: { columnIndex },
    disabled: !isDragActive,
  });

  return (
    <div
      ref={ref}
      className={`shrink-0 flex items-center justify-center transition-all duration-200 ${
        isDropTarget
          ? 'w-20 bg-indigo-500/20 border-x-2 border-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.3)]'
          : isDragActive
            ? 'w-4 bg-zinc-700/40 border-x border-dashed border-zinc-500/50'
            : 'w-0'
      }`}
    >
      {isDropTarget && (
        <div className="flex flex-col items-center gap-1">
          <div className="w-0.5 h-8 bg-indigo-400 rounded-full" />
          <span className="text-[9px] text-indigo-300 font-medium whitespace-nowrap">New column</span>
          <div className="w-0.5 h-8 bg-indigo-400 rounded-full" />
        </div>
      )}
    </div>
  );
}
