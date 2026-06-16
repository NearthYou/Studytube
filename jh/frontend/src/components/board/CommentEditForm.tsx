import type { Comment as ApiComment } from '../../api/comments'
import type { CommentEditingState } from '../../types/comment'

type CommentEditFormProps = {
  comment: ApiComment
  editingState: CommentEditingState
  isPending: boolean
  onCancelEdit: () => void
  onChangeEditingBody: (value: string) => void
  onCommentEdit: (comment: ApiComment) => void
}

export function CommentEditForm({
  comment,
  editingState,
  isPending,
  onCancelEdit,
  onChangeEditingBody,
  onCommentEdit,
}: CommentEditFormProps) {
  return (
    <div className="comment-edit-form">
      <label className="comment-compose-label" htmlFor={`comment-edit-${comment.id}`}>
        댓글 수정
      </label>
      <textarea
        id={`comment-edit-${comment.id}`}
        rows={3}
        value={editingState.body}
        onChange={(event) => onChangeEditingBody(event.target.value)}
      />
      <div className="comment-edit-actions">
        <button
          className="ui-button ui-button--primary primary-login-button"
          type="button"
          disabled={isPending}
          onClick={() => onCommentEdit(comment)}
        >
          저장
        </button>
        <button className="ui-button ui-button--ghost ghost-action-button" type="button" onClick={onCancelEdit}>
          취소
        </button>
      </div>
    </div>
  )
}
