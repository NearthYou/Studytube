import { Heart } from 'lucide-react'
import type { Comment as ApiComment } from '../../api/comments'

type CommentActionsProps = {
  comment: ApiComment
  isEditing: boolean
  isPending: boolean
  onCancelEdit: () => void
  onCommentDelete: (comment: ApiComment) => void
  onCommentLike: (comment: ApiComment) => void
  onStartEdit: (comment: ApiComment) => void
}

export function CommentActions({
  comment,
  isEditing,
  isPending,
  onCancelEdit,
  onCommentDelete,
  onCommentLike,
  onStartEdit,
}: CommentActionsProps) {
  return (
    <div className="comment-action-group">
      {comment.isOwner && (
        <>
          {isEditing ? (
            <button className="comment-text-button" type="button" onClick={onCancelEdit}>
              취소
            </button>
          ) : (
            <button className="comment-text-button" type="button" onClick={() => onStartEdit(comment)}>
              수정
            </button>
          )}
          <button className="comment-text-button" type="button" disabled={isPending} onClick={() => onCommentDelete(comment)}>
            삭제
          </button>
        </>
      )}
      <button
        className={comment.likedByMe ? 'comment-like-button is-liked' : 'comment-like-button'}
        type="button"
        aria-label={comment.likedByMe ? `${comment.author.nickname} 댓글 좋아요 취소` : `${comment.author.nickname} 댓글 좋아요`}
        aria-pressed={comment.likedByMe}
        onClick={() => onCommentLike(comment)}
      >
        <Heart className="like-icon" size={16} aria-hidden="true" />
        <span className="like-count">{comment.likeCount}</span>
      </button>
    </div>
  )
}
