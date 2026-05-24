import type { ModePromptResult, ProcessingMode } from '../../../ingestion/types';

interface ProcessingModePromptProps {
  filename: string;
  modeInfo: ModePromptResult;
  onSelect: (mode: ProcessingMode) => void;
  onCancel: () => void;
}

export function ProcessingModePrompt({
  filename,
  modeInfo,
  onSelect,
  onCancel,
}: ProcessingModePromptProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '16px',
      }}
    >
      <div
        style={{
          backgroundColor: '#18181b',
          border: '1px solid #3f3f46',
          borderRadius: '10px',
          maxWidth: '400px',
          width: '100%',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div>
          <p
            style={{
              color: '#f59e0b',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              margin: '0 0 6px 0',
            }}
          >
            Large document detected
          </p>
          <p
            style={{
              color: '#e4e4e7',
              fontSize: '14px',
              fontWeight: 600,
              margin: 0,
              wordBreak: 'break-all',
            }}
          >
            {filename}
          </p>
        </div>

        {/* Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {modeInfo.reason && (
            <p style={{ color: '#a1a1aa', fontSize: '13px', margin: 0 }}>
              {modeInfo.reason}
            </p>
          )}
          {modeInfo.estimatedCost && (
            <p style={{ color: '#71717a', fontSize: '12px', margin: 0 }}>
              {modeInfo.estimatedCost}
            </p>
          )}
        </div>

        {/* Mode buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={() => onSelect('quick')}
            style={{
              backgroundColor: '#27272a',
              border: '1px solid #3f3f46',
              borderRadius: '6px',
              padding: '12px 16px',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'background-color 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#3f3f46';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#27272a';
            }}
          >
            <p
              style={{
                color: '#e4e4e7',
                fontSize: '13px',
                fontWeight: 600,
                margin: '0 0 2px 0',
              }}
            >
              Quick overview
            </p>
            <p style={{ color: '#71717a', fontSize: '12px', margin: 0 }}>
              Extract title, abstract, and table of contents
            </p>
          </button>

          <button
            onClick={() => onSelect('full')}
            style={{
              backgroundColor: '#1e1b4b',
              border: '1px solid #4338ca',
              borderRadius: '6px',
              padding: '12px 16px',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'background-color 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2e2866';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1e1b4b';
            }}
          >
            <p
              style={{
                color: '#e4e4e7',
                fontSize: '13px',
                fontWeight: 600,
                margin: '0 0 2px 0',
              }}
            >
              Full extraction
            </p>
            <p style={{ color: '#818cf8', fontSize: '12px', margin: 0 }}>
              Process all pages — more thorough, takes longer
            </p>
          </button>
        </div>

        {/* Cancel */}
        <button
          onClick={onCancel}
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: '#71717a',
            fontSize: '13px',
            cursor: 'pointer',
            padding: '4px',
            alignSelf: 'center',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = '#a1a1aa';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = '#71717a';
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
