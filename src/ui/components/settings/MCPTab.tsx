import { useState, useEffect } from 'react';
import { vaultWorkspace } from '@platform';

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

  useEffect(() => {
    vaultWorkspace.getStatus().then((status) => {
      if (status.open) {
        setVaultPath(status.path ?? null);
        setVaultName(status.name ?? '');
      }
    });
  }, []);

  const httpConfig = JSON.stringify({
    synapse: {
      url: 'http://127.0.0.1:19876/mcp',
    },
  }, null, 2);

  const stdioConfig = JSON.stringify({
    synapse: {
      command: 'npx',
      args: [
        'synapse-kg',
        '--vault', vaultPath ?? '/path/to/vault',
        '--allow-write',
      ],
    },
  }, null, 2);

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">MCP Connection</h3>
        <p className="text-xs text-zinc-500 mt-1">
          Connect Claude Desktop, Claude Code, Codex, or any MCP client to this vault.
          Copy a config block below and paste it into your client's MCP settings.
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
            <span className="text-sm text-zinc-200 font-medium">App Running</span>
          </div>
          <p className="text-xs text-zinc-500 mb-3">
            Connects directly to the running Synapse app. Zero setup — tools are available as long as the app is open with a vault.
          </p>
          <CopyBlock label="Claude Desktop / Claude Code config" config={httpConfig} />
        </div>

        <div className="border-t border-zinc-800 pt-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-sm text-zinc-200 font-medium">Headless</span>
          </div>
          <p className="text-xs text-zinc-500 mb-3">
            Runs independently — no app needed. Connects directly to the vault's SQLite database.
            Works with Claude Code, Codex, Cursor, and any stdio MCP client.
          </p>
          <CopyBlock label="Claude Code / Codex / Cursor config" config={stdioConfig} />
        </div>
      </div>

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
