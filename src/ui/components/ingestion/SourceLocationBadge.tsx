import type { SourceLocation } from '../../../ingestion/types';

export function SourceLocationBadge({ location }: { location: SourceLocation }) {
  let label: string;
  switch (location.type) {
    case 'page':
      label = location.section
        ? `p.${location.page} · ${location.section}`
        : `p.${location.page}`;
      break;
    case 'region':
      label = location.description;
      break;
    case 'time':
      label = location.speaker
        ? `${location.timestamp} · ${location.speaker}`
        : location.timestamp;
      break;
    case 'selector':
      label = location.selector.slice(0, 20);
      break;
  }

  return (
    <span style={{
      background: '#172554',
      color: '#93c5fd',
      fontSize: '9px',
      padding: '2px 6px',
      borderRadius: '4px',
      fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
