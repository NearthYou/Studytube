import type { Comment as ApiComment } from '../../api/comments'
import type { CommentEditingState } from '../../types/comment'
import { CommentActions } from './CommentActions'
import { CommentEditForm } from './CommentEditForm'

type CommentItemProps = {
  comment: ApiComment
  editingState: CommentEditingState
  onCancelEdit: () => void
  onChangeEditingBody: (value: string) => void
  onCommentDelete: (comment: ApiComment) => void
  onCommentEdit: (comment: ApiComment) => void
  onCommentLike: (comment: ApiComment) => void
  onStartEdit: (comment: ApiComment) => void
}

export function CommentItem({
  comment,
  editingState,
  onCancelEdit,
  onChangeEditingBody,
  onCommentDelete,
  onCommentEdit,
  onCommentLike,
  onStartEdit,
}: CommentItemProps) {
  const isEditing = editingState.commentId === comment.id
  const isPending = editingState.pendingCommentId === comment.id

  return (
    <article className="comment-item">
      <div className="comment-meta">
        <div className="comment-author-meta">
          <strong>{comment.author.nickname}</strong>
          <span>{formatCommentTime(comment.createdAt)}</span>
        </div>
        <CommentActions
          comment={comment}
          isEditing={isEditing}
          isPending={isPending}
          onCancelEdit={onCancelEdit}
          onCommentDelete={onCommentDelete}
          onCommentLike={onCommentLike}
          onStartEdit={onStartEdit}
        />
      </div>

      {isEditing ? (
        <CommentEditForm
          comment={comment}
          editingState={editingState}
          isPending={isPending}
          onCancelEdit={onCancelEdit}
          onChangeEditingBody={onChangeEditingBody}
          onCommentEdit={onCommentEdit}
        />
      ) : (
        <p>{comment.body}</p>
      )}
    </article>
  )
}

function formatCommentTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
