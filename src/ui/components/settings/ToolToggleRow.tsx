interface ToolToggleRowProps {
  name: string;
  description: string;
  enabled: boolean;
  locked?: boolean;
  variant?: 'default' | 'destructive';
  onToggle: (name: string, enabled: boolean) => void;
}

export function ToolToggleRow({ name, description, enabled, locked, variant, onToggle }: ToolToggleRowProps) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 px-2 rounded ${
        variant === 'destructive' ? 'bg-red-950/20' : ''
      }`}
    >
      <div className="min-w-0 flex-1 mr-3">
        <span className="text-xs font-mono text-zinc-200">{name}</span>
        <span className="text-[10px] text-zinc-500 ml-2">{description}</span>
      </div>
      <input
        type="checkbox"
        checked={enabled}
        disabled={locked}
        onChange={() => onToggle(name, !enabled)}
        className={`toggle-switch shrink-0 ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}
      />
    </div>
  );
}
