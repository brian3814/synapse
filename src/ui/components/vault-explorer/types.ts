export interface VaultFileEntry {
  id: string;
  name: string;
  isFolder: boolean;
  children?: VaultFileEntry[];
  isInternal?: boolean;
}
