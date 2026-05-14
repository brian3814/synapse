import type { VaultSandboxConfig } from '../../shared/agent-settings-types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

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
    return window.electronIPC.invoke('vault-workspace:get-status') as Promise<VaultStatus>;
  },

  async getRecent(): Promise<RecentVault[]> {
    return window.electronIPC.invoke('vault-workspace:get-recent') as Promise<RecentVault[]>;
  },

  async create(vaultPath: string, name: string): Promise<VaultInfo> {
    return window.electronIPC.invoke('vault-workspace:create', vaultPath, name) as Promise<VaultInfo>;
  },

  async open(vaultPath: string): Promise<VaultInfo> {
    return window.electronIPC.invoke('vault-workspace:open', vaultPath) as Promise<VaultInfo>;
  },

  async pickAndCreate(): Promise<VaultInfo | null> {
    return window.electronIPC.invoke('vault-workspace:pick-create') as Promise<VaultInfo | null>;
  },

  async pickAndOpen(): Promise<VaultInfo | null> {
    return window.electronIPC.invoke('vault-workspace:pick-open') as Promise<VaultInfo | null>;
  },

  async close(): Promise<void> {
    await window.electronIPC.invoke('vault-workspace:close');
  },

  async getSandboxConfig(): Promise<VaultSandboxConfig | null> {
    return window.electronIPC.invoke('vault-workspace:get-sandbox-config') as Promise<VaultSandboxConfig | null>;
  },

  async setSandboxConfig(config: VaultSandboxConfig): Promise<void> {
    await window.electronIPC.invoke('vault-workspace:set-sandbox-config', config);
  },
};
