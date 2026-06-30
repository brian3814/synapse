import { useState, useEffect } from 'react';
import { vaultWorkspace, storage } from '@platform';

function CopyBlock({ label, config }: { label: string; config: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(config).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        <button
          onClick={handleCopy}
          className="text-xs px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="bg-zinc-950 border border-zinc-700 rounded p-3 text-xs text-zinc-300 overflow-x-auto whitespace-pre">
        {config}
      </pre>
    </div>
  );
}

export function MCPTab() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [vaultName, setVaultName] = useState<string>('');
  const [companionPort, setCompanionPort] = useState<number | null>(null);

  useEffect(() => {
    vaultWorkspace.getStatus().then((status) => {
      if (status.open) {
        setVaultPath(status.path ?? null);
        setVaultName(status.name ?? '');
      }
    });
    storage.get<{ companionPort?: number }>('companionPort').then((data) => {
      if (data.companionPort) setCompanionPort(data.companionPort);
    });
  }, []);

  const vault = vaultPath ?? '/path/to/vault';

  const claudeDesktopConfig = JSON.stringify({
    mcpServers: {
      synapse: {
        command: 'npx',
        args: ['synapse-kg', '--vault', vault, '--allow-write'],
      },
    },
  }, null, 2);

  const claudeCodeConfig = JSON.stringify({
    mcpServers: {
      synapse: {
        command: 'npx',
        args: ['synapse-kg', '--vault', vault, '--allow-write'],
      },
    },
  }, null, 2);

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">MCP Connection</h3>
        <p className="text-xs text-zinc-500 mt-1">
          Connect Claude Desktop, Claude Code, Codex, or any MCP client to this vault.
          Copy the config below and merge it into your client's MCP config file.
        </p>
      </div>

      {vaultPath && (
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded text-xs">
          <span className="text-zinc-500">Active vault:</span>
          <span className="text-zinc-300 font-medium">{vaultName}</span>
          <span className="text-zinc-600 truncate">{vaultPath}</span>
        </div>
      )}

      <div className="space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm text-zinc-200 font-medium">Claude Desktop</span>
          </div>

          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-emerald-400">Recommended</span>
              <span className="text-xs text-zinc-500">— Install as Desktop Extension</span>
            </div>
            <p className="text-xs text-zinc-500 mb-2">
              Run in your terminal. Claude Desktop will prompt for your vault path on first use.
            </p>
            <CopyBlock label="Terminal" config="claude desktop-extension install synapse-kg" />
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 border-t border-zinc-700" />
            <span className="text-xs text-zinc-600">or configure manually</span>
            <div className="flex-1 border-t border-zinc-700" />
          </div>

          <p className="text-xs text-zinc-500 mb-3">
            Add to <code className="text-zinc-400">~/Library/Application Support/Claude/claude_desktop_config.json</code>
          </p>
          <CopyBlock label="claude_desktop_config.json" config={claudeDesktopConfig} />
        </div>

        <div className="border-t border-zinc-800 pt-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-sm text-zinc-200 font-medium">Claude Code / Codex / Cursor</span>
          </div>
          <p className="text-xs text-zinc-500 mb-3">
            Add to <code className="text-zinc-400">.claude.json</code> (Claude Code) or <code className="text-zinc-400">.cursor/mcp.json</code> (Cursor)
          </p>
          <CopyBlock label=".claude.json / .cursor/mcp.json" config={claudeCodeConfig} />
        </div>
      </div>

      {!vaultPath && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/20 border border-amber-800/40 rounded text-xs text-amber-400">
          Open a vault first — the config will auto-fill with the vault path.
        </div>
      )}

      {companionPort && (
        <div className="border-t border-zinc-800 pt-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-sm text-zinc-200 font-medium">HTTP Transport</span>
          </div>
          <p className="text-xs text-zinc-500 mb-3">
            For HTTP-based MCP clients. The Synapse desktop app must be running.
          </p>
          <CopyBlock label="MCP Endpoint" config={`http://127.0.0.1:${companionPort}/mcp`} />
        </div>
      )}

      <div className="border-t border-zinc-800 pt-5">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-2">Available Tools</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {TOOLS.map((t) => (
            <div key={t.name} className="flex items-start gap-2 px-2 py-1.5 rounded bg-zinc-800/30">
              <code className="text-xs text-indigo-400 shrink-0">{t.name}</code>
              <span className="text-xs text-zinc-500">{t.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TOOLS = [
  { name: 'search', desc: 'Find entities, notes, sources' },
  { name: 'get_entity', desc: 'Full entity details' },
  { name: 'get_neighbors', desc: 'Graph traversal' },
  { name: 'manage_entity', desc: 'Create / update / delete' },
  { name: 'manage_relationship', desc: 'Edge CRUD' },
  { name: 'merge_entities', desc: 'Deduplicate' },
  { name: 'manage_note', desc: 'Note read / create / update' },
  { name: 'analyze_graph', desc: 'Intelligence analyses' },
];
