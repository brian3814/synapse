import { useState, useEffect, useCallback } from 'react';
import { platformId } from '@platform';
import { vaultWorkspace } from '@platform';
import type { VaultStatus } from '@platform/vault-workspace';

export function useVaultStatus() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (platformId !== 'electron') {
      setStatus({ open: true });
      setChecking(false);
      return;
    }
    vaultWorkspace.getStatus().then((s) => {
      setStatus(s);
      setChecking(false);
    });
  }, []);

  const refresh = useCallback(() => {
    setChecking(true);
    vaultWorkspace.getStatus().then((s) => {
      setStatus(s);
      setChecking(false);
    });
  }, []);

  return {
    vaultOpen: status?.open ?? false,
    vaultName: status?.name ?? null,
    vaultPath: status?.path ?? null,
    checking,
    refresh,
  };
}
