import { useCallback, useEffect, useState } from 'react';
import { vaultWorkspace } from '@platform';
import type { RecentVault } from '@platform/vault-workspace';

interface Props {
  onVaultReady: () => void;
}

type VaultIssue =
  | { kind: 'kg_missing'; path: string }
  | { kind: 'dir_missing'; path: string };

function parseVaultError(e: unknown): VaultIssue | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('VAULT_KG_MISSING:')) return { kind: 'kg_missing', path: msg.split('VAULT_KG_MISSING:')[1] };
  if (msg.includes('VAULT_DIR_MISSING:')) return { kind: 'dir_missing', path: msg.split('VAULT_DIR_MISSING:')[1] };
  return null;
}

export function VaultSetupScreen({ onVaultReady }: Props) {
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vaultIssue, setVaultIssue] = useState<VaultIssue | null>(null);

  const refreshRecent = useCallback(() => {
    vaultWorkspace.getRecent().then(setRecentVaults).catch(() => {});
  }, []);

  useEffect(() => { refreshRecent(); }, [refreshRecent]);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setVaultIssue(null);
    try {
      const result = await vaultWorkspace.pickAndCreate();
      if (result) onVaultReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create vault');
    } finally {
      setLoading(false);
    }
  }, [onVaultReady]);

  const handleOpen = useCallback(async () => {
    setLoading(true);
    setError(null);
    setVaultIssue(null);
    try {
      const result = await vaultWorkspace.pickAndOpen();
      if (result) onVaultReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open vault');
    } finally {
      setLoading(false);
    }
  }, [onVaultReady]);

  const handleOpenRecent = useCallback(async (vaultPath: string) => {
    setLoading(true);
    setError(null);
    setVaultIssue(null);
    try {
      await vaultWorkspace.open(vaultPath);
      onVaultReady();
    } catch (e) {
      const issue = parseVaultError(e);
      if (issue) {
        setVaultIssue(issue);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to open vault');
      }
    } finally {
      setLoading(false);
    }
  }, [onVaultReady]);

  const handleReinitialize = useCallback(async () => {
    if (!vaultIssue) return;
    setLoading(true);
    setVaultIssue(null);
    setError(null);
    try {
      await vaultWorkspace.reinitialize(vaultIssue.path);
      onVaultReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reinitialize vault');
    } finally {
      setLoading(false);
    }
  }, [vaultIssue, onVaultReady]);

  const handleDismissIssue = useCallback(async () => {
    if (!vaultIssue) return;
    const issuePath = vaultIssue.path;
    setVaultIssue(null);
    await vaultWorkspace.removeRecent(issuePath);
    refreshRecent();
  }, [vaultIssue, refreshRecent]);

  return (
    <div className="flex items-center justify-center h-screen bg-zinc-900">
      {vaultIssue && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
          <div className="bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl p-5 max-w-sm w-full mx-4">
            {vaultIssue.kind === 'dir_missing' ? (
              <>
                <h3 className="text-sm font-semibold text-zinc-100 mb-2">Vault not found</h3>
                <p className="text-[12px] text-zinc-400 mb-1">
                  The folder for this vault no longer exists. It will be removed from your recent vaults.
                </p>
                <p className="text-[12px] text-zinc-500 mb-4 truncate">{vaultIssue.path}</p>
                <div className="flex justify-end">
                  <button
                    onClick={handleDismissIssue}
                    className="px-3 py-1.5 text-[12px] rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
                  >
                    OK
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-zinc-100 mb-2">Vault data missing</h3>
                <p className="text-[12px] text-zinc-400 mb-1">
                  This vault's data folder (<span className="text-zinc-300">.synapse</span>) is missing.
                  It may have been deleted or cleaned up. Would you like to reinitialize it as a fresh vault?
                </p>
                <p className="text-[12px] text-zinc-500 mb-4 truncate">{vaultIssue.path}</p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={handleDismissIssue}
                    className="px-3 py-1.5 text-[12px] rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
                  >
                    Remove from list
                  </button>
                  <button
                    onClick={handleReinitialize}
                    disabled={loading}
                    className="px-3 py-1.5 text-[12px] rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                  >
                    Reinitialize vault
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-zinc-100">Synapse</h1>
          <p className="text-zinc-400 mt-2 text-sm">
            Choose a vault to get started. A vault is a folder that contains your notes, files, and graph data.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            Create New Vault
          </button>
          <button
            onClick={handleOpen}
            disabled={loading}
            className="w-full px-4 py-3 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-100 rounded-lg font-medium transition-colors"
          >
            Open Existing Vault
          </button>
        </div>

        {recentVaults.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Recent Vaults</h2>
            <div className="space-y-1">
              {recentVaults.map((v) => (
                <button
                  key={v.path}
                  onClick={() => handleOpenRecent(v.path)}
                  disabled={loading}
                  className="w-full text-left px-3 py-2 rounded hover:bg-zinc-800 disabled:opacity-50 transition-colors group"
                >
                  <span className="text-zinc-200 text-sm font-medium">{v.name}</span>
                  <span className="block text-zinc-500 text-xs truncate">{v.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 text-red-400 text-sm text-center">{error}</p>
        )}

        {loading && (
          <div className="mt-4 flex justify-center">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
