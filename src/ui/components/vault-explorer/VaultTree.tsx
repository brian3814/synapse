import { useRef, useCallback } from 'react';
import { Tree, type TreeApi, type MoveHandler, type RenameHandler, type DeleteHandler } from 'react-arborist';
import { VaultTreeNode } from './VaultTreeNode';
import type { VaultFileEntry } from './types';

interface VaultTreeProps {
  data: VaultFileEntry[];
  height: number;
  onActivate: (node: VaultFileEntry) => void;
  onRename: (oldPath: string, newName: string) => Promise<void>;
  onMove: (sourcePath: string, destDir: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
}

export function VaultTree({
  data,
  height,
  onActivate,
  onRename,
  onMove,
  onDelete,
}: VaultTreeProps) {
  const treeRef = useRef<TreeApi<VaultFileEntry>>(null);

  const handleRename: RenameHandler<VaultFileEntry> = useCallback(({ id, name }) => {
    onRename(id, name);
  }, [onRename]);

  const handleMove: MoveHandler<VaultFileEntry> = useCallback(({ dragIds, parentId }) => {
    if (!parentId) return;
    for (const id of dragIds) {
      onMove(id, parentId);
    }
  }, [onMove]);

  const handleDelete: DeleteHandler<VaultFileEntry> = useCallback(({ ids }) => {
    for (const id of ids) {
      onDelete(id);
    }
  }, [onDelete]);

  const handleActivate = useCallback((node: { data: VaultFileEntry }) => {
    onActivate(node.data);
  }, [onActivate]);

  return (
    <Tree<VaultFileEntry>
      ref={treeRef}
      data={data}
      width="100%"
      height={height}
      rowHeight={26}
      indent={16}
      openByDefault={false}
      onRename={handleRename}
      onMove={handleMove}
      onDelete={handleDelete}
      onActivate={handleActivate}
      disableDrag={(node: any) => node.data?.isInternal === true}
      disableDrop={(args: any) => {
        const target = args.parentNode;
        if (!target) return false;
        return target.data?.isInternal === true;
      }}
    >
      {VaultTreeNode}
    </Tree>
  );
}
