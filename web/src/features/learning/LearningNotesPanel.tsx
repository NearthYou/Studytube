import { useState, type RefObject } from "react";
import type { LearningNote } from "../../types.ts";
import { formatTime } from "../../videoSummaryDetails.ts";

export function LearningNotesPanel({
  busyId,
  draft,
  inputRef,
  notes,
  positionSeconds,
  status,
  onDelete,
  onDraftChange,
  onSave,
  onSeek,
  onUpdate,
}: {
  busyId: string;
  draft: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  notes: LearningNote[];
  positionSeconds: number;
  status: string;
  onDelete: (note: LearningNote) => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onSeek: (seconds: number) => void;
  onUpdate: (note: LearningNote, body: string) => void;
}) {
  return (
    <section className="learning-notes-panel">
      <label htmlFor="learning-note">
        {formatTime(positionSeconds)}에 남길 메모
      </label>
      <textarea
        id="learning-note"
        ref={inputRef}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder="이 장면에서 기억할 내용을 적어보세요."
      />
      <div className="learning-note-actions">
        <button
          disabled={busyId === "new" || !draft.trim()}
          type="button"
          onClick={onSave}
        >
          메모 저장
        </button>
      </div>
      <p className="sentence-status" aria-live="polite">
        {status}
      </p>
      <div className="learning-note-list">
        {notes.map((note) => (
          <NoteEditor
            busy={busyId === note.id}
            key={note.id}
            note={note}
            onDelete={() => onDelete(note)}
            onSave={(body) => onUpdate(note, body)}
            onSeek={() => onSeek(note.positionSeconds)}
          />
        ))}
        {notes.length === 0 && <p>저장한 메모가 아직 없습니다.</p>}
      </div>
    </section>
  );
}

function NoteEditor({
  busy,
  note,
  onDelete,
  onSave,
  onSeek,
}: {
  busy: boolean;
  note: LearningNote;
  onDelete: () => void;
  onSave: (body: string) => void;
  onSeek: () => void;
}) {
  const [body, setBody] = useState(note.body);
  return (
    <article>
      <button className="note-time" type="button" onClick={onSeek}>
        {formatTime(note.positionSeconds)}
      </button>
      <textarea
        aria-label={`${formatTime(note.positionSeconds)} 메모 내용`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div>
        <button
          disabled={busy || body.trim() === note.body}
          type="button"
          onClick={() => onSave(body)}
        >
          수정
        </button>
        <button disabled={busy} type="button" onClick={onDelete}>
          삭제
        </button>
      </div>
    </article>
  );
}
