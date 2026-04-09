import { useState } from 'react';
import {
  useExtractionReviewStore,
  type ReviewNote,
} from '../../../graph/store/extraction-review-store';

interface ReviewNoteItemProps {
  note: ReviewNote;
}

/**
 * Review UI for an LLM-generated note (Phase 4).
 *
 * Shows the note title, a collapsed/expanded content preview, and chips
 * for about/mention entity bindings. Clicking a chip toggles about ↔ mention.
 */
export function ReviewNoteItem({ note }: ReviewNoteItemProps) {
  const selectedTempId = useExtractionReviewStore((s) => s.selectedTempId);
  const selectedType = useExtractionReviewStore((s) => s.selectedType);
  const select = useExtractionReviewStore((s) => s.select);
  const editNote = useExtractionReviewStore((s) => s.editNote);
  const removeNote = useExtractionReviewStore((s) => s.removeNote);
  const toggleBinding = useExtractionReviewStore((s) => s.toggleNoteBinding);
  const nodes = useExtractionReviewStore((s) => s.nodes);

  const isSelected = selectedTempId === note.tempId && selectedType === 'note';

  const [editTitle, setEditTitle] = useState(note.title);
  const [editContent, setEditContent] = useState(note.content);

  const entityName = (tempId: string): string =>
    nodes.find((n) => n.tempId === tempId)?.name ?? 'Unknown';

  const handleClick = () => {
    if (isSelected) {
      select(null, null);
    } else {
      select(note.tempId, 'note');
      setEditTitle(note.title);
      setEditContent(note.content);
    }
  };

  const handleSave = () => {
    const changes: Partial<Pick<ReviewNote, 'title' | 'content'>> = {};
    if (editTitle !== note.title) changes.title = editTitle;
    if (editContent !== note.content) changes.content = editContent;
    if (Object.keys(changes).length > 0) {
      editNote(note.tempId, changes);
    }
  };

  const contentPreview = note.content.length > 120
    ? note.content.slice(0, 120) + '...'
    : note.content;

  return (
    <div
      className={`rounded border bg-sky-900/20 border-sky-800/30 transition-all ${
        isSelected ? 'ring-1 ring-indigo-500' : ''
      }`}
    >
      {/* Header */}
      <div
        className="flex items-start gap-2 px-3 py-2 cursor-pointer"
        onClick={handleClick}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
          style={{ backgroundColor: '#0EA5E9' }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-zinc-200 font-medium truncate">{note.title}</div>
          {!isSelected && (
            <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{contentPreview}</div>
          )}
        </div>
        <span className="text-[10px] text-zinc-500 shrink-0 mt-1">note</span>
      </div>

      {/* Binding chips (always visible) */}
      {(note.about.length > 0 || note.mentions.length > 0) && !isSelected && (
        <div className="px-3 pb-2 pl-7 flex flex-wrap gap-1">
          {note.about.map((eId) => (
            <span
              key={`about-${eId}`}
              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-800/60 text-emerald-200"
              title="Primary subject (about)"
            >
              {entityName(eId)}
            </span>
          ))}
          {note.mentions.map((eId) => (
            <span
              key={`mention-${eId}`}
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300"
              title="Incidental mention"
            >
              {entityName(eId)}
            </span>
          ))}
        </div>
      )}

      {/* Selected: inline edit */}
      {isSelected && (
        <div className="px-3 pb-3 pl-7 space-y-2">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSave}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
            placeholder="Note title"
            onClick={(e) => e.stopPropagation()}
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onBlur={handleSave}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500 min-h-[80px] resize-y"
            placeholder="Note content (supports [[wikilinks]])"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Editable binding chips — click to toggle about ↔ mention */}
          <div className="space-y-1">
            <p className="text-[10px] text-zinc-500">Click a chip to toggle primary/incidental:</p>
            <div className="flex flex-wrap gap-1">
              {note.about.map((eId) => (
                <button
                  key={`edit-about-${eId}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBinding(note.tempId, eId);
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-800/60 text-emerald-200 hover:bg-emerald-700/60"
                  title="about → click to make a mention"
                >
                  ★ {entityName(eId)}
                </button>
              ))}
              {note.mentions.map((eId) => (
                <button
                  key={`edit-mention-${eId}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBinding(note.tempId, eId);
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60"
                  title="mention → click to make it primary (about)"
                >
                  {entityName(eId)}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              removeNote(note.tempId);
            }}
            className="text-[10px] px-2 py-1 rounded bg-red-900/50 text-red-300 hover:bg-red-800/50"
          >
            Remove note
          </button>
        </div>
      )}
    </div>
  );
}
