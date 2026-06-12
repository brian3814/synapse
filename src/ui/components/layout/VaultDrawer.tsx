import { VaultExplorer } from '../vault-explorer';

interface VaultDrawerProps {
  rootPath: string;
  onOpenFile: (path: string, fileType: string) => void;
}

export function VaultDrawer({ rootPath, onOpenFile }: VaultDrawerProps) {
  return <VaultExplorer rootPath={rootPath} onOpenFile={onOpenFile} />;
}
