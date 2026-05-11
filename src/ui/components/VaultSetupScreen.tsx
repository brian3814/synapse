import { useCallback, useEffect, useState } from 'react';
import { vaultWorkspace } from '@platform';
import type { RecentVault } from '@platform/vault-workspace';

interface Props {
  onVaultReady: () => void;
}

export function VaultSetupScreen({ onVaultReady }: Props) {
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    vaultWorkspace.getRecent().then(setRecentVaults).catch(() => {});
  }, []);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    setError(null);
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
    try {
      await vaultWorkspace.open(vaultPath);
      onVaultReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open vault');
    } finally {
      setLoading(false);
    }
  }, [onVaultReady]);

  return (
    <div className="flex items-center justify-center h-screen bg-zinc-900">
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
