import { useEffect, useReducer, type RefObject } from "react";
import type { LearningNote } from "../../types.ts";
import { formatTime } from "../../videoSummaryDetails.ts";
import {
  canSaveSavedNote,
  createSavedNoteState,
  transitionSavedNote,
} from "./savedNoteFlow.ts";

export function LearningNotesPanel({
  busyId,
  draft,
  inputRef,
  notes,
  positionSeconds,
  source,
  korean,
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
  source: string;
  korean: string;
  status: string;
  onDelete: (note: LearningNote) => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onSeek: (seconds: number) => void;
  onUpdate: (note: LearningNote, body: string) => void;
}) {
  return (
    <section className="learning-notes-panel">
      <div className="learning-note-composer">
        <header>
          <div>
            <strong>메모 작성</strong>
            <span>고정된 장면에 저장됩니다.</span>
          </div>
          <time>{formatTime(positionSeconds)}</time>
        </header>

        {(source || korean) && (
          <div className="learning-note-context">
            {source && <p>{source}</p>}
            {korean && <p lang="ko">{korean}</p>}
          </div>
        )}

        <label htmlFor="learning-note">내 메모</label>
        <textarea
          id="learning-note"
          maxLength={4000}
          ref={inputRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="이 장면에서 기억할 내용이나 떠오른 생각을 적어보세요."
        />
        <div className="learning-note-actions">
          <span>{draft.length.toLocaleString()} / 4,000</span>
          <button
            disabled={busyId === "new" || !draft.trim()}
            type="button"
            onClick={onSave}
          >
            {busyId === "new" ? "저장 중" : "메모 저장"}
          </button>
        </div>
        {status && (
          <p className="sentence-status" aria-live="polite">
            {status}
          </p>
        )}
      </div>

      <header className="learning-note-list-heading">
        <strong>저장한 메모</strong>
        <span>{notes.length}개</span>
      </header>
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
        {notes.length === 0 && (
          <p className="learning-note-empty">
            저장한 메모가 없습니다. 기억하고 싶은 문장부터 남겨보세요.
          </p>
        )}
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
  const [state, dispatch] = useReducer(
    transitionSavedNote,
    note.body,
    createSavedNoteState,
  );
  useEffect(() => {
    dispatch({ type: "sync", body: note.body });
  }, [note.body]);

  return (
    <article className={`saved-note-card is-${state.mode}`}>
      <header className="saved-note-card-header">
        <button
          className="note-time"
          title={`${formatTime(note.positionSeconds)} 장면으로 이동`}
          type="button"
          onClick={onSeek}
        >
          {formatTime(note.positionSeconds)}
        </button>
        {state.mode === "view" && (
          <div className="saved-note-card-actions">
            <button
              className="quiet-button"
              disabled={busy}
              type="button"
              onClick={() => dispatch({ type: "edit" })}
            >
              수정
            </button>
            <button
              className="quiet-button danger-button"
              disabled={busy}
              type="button"
              onClick={onDelete}
            >
              삭제
            </button>
          </div>
        )}
      </header>

      {state.mode === "view" ? (
        <p className="saved-note-body">{note.body}</p>
      ) : (
        <>
          <textarea
            aria-label={`${formatTime(note.positionSeconds)} 메모 내용`}
            autoFocus
            maxLength={4000}
            value={state.draftBody}
            onChange={(event) =>
              dispatch({ type: "change", body: event.target.value })
            }
          />
          <div className="saved-note-edit-actions">
            <span>{state.draftBody.length.toLocaleString()} / 4,000</span>
            <button
              className="quiet-button"
              disabled={busy}
              type="button"
              onClick={() => dispatch({ type: "cancel" })}
            >
              취소
            </button>
            <button
              disabled={busy || !canSaveSavedNote(state)}
              type="button"
              onClick={() => onSave(state.draftBody)}
            >
              {busy ? "저장 중" : "저장"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}
