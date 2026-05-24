import { useState, useEffect } from 'react';
import { vaultWorkspace } from '@platform';
import type { VaultSandboxConfig } from '../../../shared/agent-settings-types';
import { DEFAULT_SANDBOX_CONFIG } from '../../../shared/agent-settings-types';

export function VaultSandboxSection() {
  const [vaultOpen, setVaultOpen] = useState(false);
  const [config, setConfig] = useState<VaultSandboxConfig>({ ...DEFAULT_SANDBOX_CONFIG });
  const [saved, setSaved] = useState(false);
  const [newDir, setNewDir] = useState('');
  const [newExt, setNewExt] = useState('');

  useEffect(() => {
    vaultWorkspace.getStatus().then((status) => {
      setVaultOpen(status.open);
      if (status.open) {
        vaultWorkspace.getSandboxConfig().then((cfg) => {
          if (cfg) setConfig(cfg);
        });
      }
    });
  }, []);

  const handleSave = async (updated: VaultSandboxConfig) => {
    setConfig(updated);
    await vaultWorkspace.setSandboxConfig(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addDir = () => {
    const dir = newDir.trim().replace(/\/$/, '') + '/';
    if (!dir || dir === '/' || config.allowedDirs.includes(dir)) return;
    handleSave({ ...config, allowedDirs: [...config.allowedDirs, dir] });
    setNewDir('');
  };

  const removeDir = (dir: string) => {
    handleSave({ ...config, allowedDirs: config.allowedDirs.filter((d) => d !== dir) });
  };

  const addExt = () => {
    let ext = newExt.trim().toLowerCase();
    if (!ext.startsWith('.')) ext = '.' + ext;
    if (ext === '.' || config.blockedExtensions.includes(ext)) return;
    handleSave({ ...config, blockedExtensions: [...config.blockedExtensions, ext] });
    setNewExt('');
  };

  const removeExt = (ext: string) => {
    handleSave({ ...config, blockedExtensions: config.blockedExtensions.filter((e) => e !== ext) });
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-zinc-400">Vault Sandbox</h4>
        {saved && <span className="text-[10px] text-green-400">Saved!</span>}
      </div>

      {!vaultOpen ? (
        <p className="text-[10px] text-zinc-600">Open a vault to configure sandbox rules.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-[10px] text-zinc-600">
            Stored in this vault — rules apply per-vault.
          </p>

          {/* Allowed Directories */}
          <div>
            <label className="text-[10px] text-zinc-500 block mb-1">Allowed Directories</label>
            <p className="text-[10px] text-zinc-600 mb-1.5">Empty = full vault access.</p>
            <div className="space-y-1 mb-1.5">
              {config.allowedDirs.map((dir) => (
                <div key={dir} className="flex items-center gap-1">
                  <span className="text-xs font-mono text-zinc-300 bg-zinc-800 rounded px-1.5 py-0.5 flex-1">{dir}</span>
                  <button
                    onClick={() => removeDir(dir)}
                    className="text-zinc-500 hover:text-red-400 text-xs px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={newDir}
                onChange={(e) => setNewDir(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDir()}
                placeholder="e.g. research/"
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
              />
              <button onClick={addDir} className="px-2 py-1 bg-zinc-700 text-zinc-300 text-xs rounded hover:bg-zinc-600">
                +
              </button>
            </div>
          </div>

          {/* Blocked Extensions */}
          <div>
            <label className="text-[10px] text-zinc-500 block mb-1">Blocked File Extensions</label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {config.blockedExtensions.map((ext) => (
                <span key={ext} className="inline-flex items-center bg-zinc-800 text-zinc-300 text-xs rounded px-1.5 py-0.5 font-mono">
                  {ext}
                  <button
                    onClick={() => removeExt(ext)}
                    className="ml-1 text-zinc-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={newExt}
                onChange={(e) => setNewExt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExt()}
                placeholder="e.g. .secret"
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
              />
              <button onClick={addExt} className="px-2 py-1 bg-zinc-700 text-zinc-300 text-xs rounded hover:bg-zinc-600">
                +
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
