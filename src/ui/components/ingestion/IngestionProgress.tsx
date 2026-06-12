interface IngestionProgressProps {
  percent: number;
  message: string;
}

export function IngestionProgress({ percent, message }: IngestionProgressProps) {
  const clampedPercent = Math.max(0, Math.min(100, percent));

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px',
          fontSize: '12px',
          color: '#a1a1aa',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message}
        </span>
        <span style={{ marginLeft: '8px', flexShrink: 0, color: '#818cf8' }}>
          {clampedPercent}%
        </span>
      </div>

      <div
        style={{
          width: '100%',
          height: '4px',
          backgroundColor: '#3f3f46',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${clampedPercent}%`,
            backgroundColor: '#6366f1',
            borderRadius: '2px',
            transition: 'width 0.2s ease',
          }}
        />
      </div>
    </div>
  );
}
