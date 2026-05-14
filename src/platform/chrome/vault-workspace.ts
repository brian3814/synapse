import type { VaultSandboxConfig } from '../../shared/agent-settings-types';

export interface VaultStatus {
  open: boolean;
  path?: string;
  name?: string;
  id?: string;
}

export interface RecentVault {
  path: string;
  name: string;
  lastOpened: string;
}

export interface VaultInfo {
  path: string;
  name: string;
  id: string;
}

export const vaultWorkspace = {
  async getStatus(): Promise<VaultStatus> {
    return { open: false };
  },
  async getRecent(): Promise<RecentVault[]> {
    return [];
  },
  async create(_vaultPath: string, _name: string): Promise<VaultInfo> {
    throw new Error('Vault workspace not supported in Chrome extension');
  },
  async open(_vaultPath: string): Promise<VaultInfo> {
    throw new Error('Vault workspace not supported in Chrome extension');
  },
  async pickAndCreate(): Promise<VaultInfo | null> {
    return null;
  },
  async pickAndOpen(): Promise<VaultInfo | null> {
    return null;
  },
  async close(): Promise<void> {},
  async getSandboxConfig(): Promise<VaultSandboxConfig | null> {
    return null;
  },
  async setSandboxConfig(_config: VaultSandboxConfig): Promise<void> {},
};
