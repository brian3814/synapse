import { useCallback } from 'react';
import type { NodeRendererProps } from 'react-arborist';
import type { VaultFileEntry } from './types';
import { getFileIcon } from './file-type-utils';

export function VaultTreeNode({ node, style, dragHandle }: NodeRendererProps<VaultFileEntry>) {
  const data = node.data;
  const isInternal = data.isInternal;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isInternal) return;

    const menu = document.createElement('div');
    menu.className = 'fixed z-[9999] bg-zinc-800 border border-zinc-600 rounded shadow-lg py-1 text-[12px] text-zinc-200';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const items: { label: string; action: () => void }[] = [];

    if (data.isFolder) {
      items.push({ label: 'New File', action: () => node.tree.create({ parentId: node.id, type: 'leaf' }) });
      items.push({ label: 'New Folder', action: () => node.tree.create({ parentId: node.id, type: 'internal' }) });
    }
    items.push({ label: 'Rename', action: () => node.edit() });
    items.push({ label: 'Delete', action: () => node.tree.delete(node.id) });

    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'block w-full text-left px-3 py-1 hover:bg-zinc-700';
      btn.textContent = item.label;
      btn.onclick = () => { item.action(); menu.remove(); };
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }, [node, data, isInternal]);

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`flex items-center gap-1.5 pr-2 py-0.5 cursor-pointer select-none text-[12px] leading-5 rounded
        ${node.isSelected ? 'bg-indigo-600/30 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-700/50'}
        ${isInternal ? 'opacity-40' : ''}
      `}
      onClick={() => {
        if (node.isLeaf) node.activate();
        else node.toggle();
      }}
      onDoubleClick={() => {
        if (isInternal) return;
        if (node.isLeaf) node.activate();
        else node.toggle();
      }}
      onContextMenu={handleContextMenu}
    >
      <span className="w-4 flex-shrink-0 text-center text-[10px] text-zinc-500">
        {data.isFolder ? (node.isOpen ? '▾' : '▸') : ''}
      </span>

      <span className="flex-shrink-0 text-[11px]">
        {data.isFolder ? (node.isOpen ? '📂' : '📁') : getFileIcon(data.name, false)}
      </span>

      {node.isEditing ? (
        <input
          type="text"
          defaultValue={data.name}
          autoFocus
          className="flex-1 min-w-0 bg-zinc-800 border border-indigo-500 rounded px-1 text-[12px] text-zinc-100 outline-none"
          onFocus={(e) => {
            const dot = data.name.lastIndexOf('.');
            if (dot > 0 && !data.isFolder) {
              e.target.setSelectionRange(0, dot);
            } else {
              e.target.select();
            }
          }}
          onBlur={() => node.reset()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') node.reset();
            if (e.key === 'Enter') node.submit(e.currentTarget.value);
          }}
        />
      ) : (
        <span className="truncate flex-1 min-w-0">{data.name}</span>
      )}
    </div>
  );
}
