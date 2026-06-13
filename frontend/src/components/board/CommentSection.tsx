import { Send } from 'lucide-react'
import type { Comment as ApiComment } from '../../api/comments'
import type { CommentEditingState } from '../../types/comment'
import { CommentItem } from './CommentItem'

type CommentSectionProps = {
  commentBody: string
  comments: ApiComment[]
  editingState: CommentEditingState
  isLoading: boolean
  onCancelEdit: () => void
  onChangeCommentBody: (value: string) => void
  onChangeEditingBody: (value: string) => void
  onCommentDelete: (comment: ApiComment) => void
  onCommentEdit: (comment: ApiComment) => void
  onCommentLike: (comment: ApiComment) => void
  onCommentSubmit: () => void
  onLoadMore: () => void
  onStartEdit: (comment: ApiComment) => void
  hasCommentLoadError: boolean
  hasMoreComments: boolean
  status: string
  isLoadingMore: boolean
  totalCount: number
}

export function CommentSection({
  commentBody,
  comments,
  editingState,
  isLoading,
  onCancelEdit,
  onChangeCommentBody,
  onChangeEditingBody,
  onCommentDelete,
  onCommentEdit,
  onCommentLike,
  onCommentSubmit,
  onLoadMore,
  onStartEdit,
  hasCommentLoadError,
  hasMoreComments,
  status,
  isLoadingMore,
  totalCount,
}: CommentSectionProps) {
  return (
    <section
      className="board-panel detail-comments-section detail-comments-panel"
      id="detail-comments"
      aria-labelledby="detail-comments-title"
    >
      <div className="detail-comments-heading">
        <h2 id="detail-comments-title">댓글</h2>
        <span>{totalCount}</span>
      </div>

      <div className="comment-compose">
        <label className="comment-compose-label" htmlFor="detail-comment-body">
          댓글 입력
        </label>
        <textarea
          id="detail-comment-body"
          placeholder="댓글을 입력해 주세요."
          rows={3}
          value={commentBody}
          onChange={(event) => onChangeCommentBody(event.target.value)}
        />
        <button className="ui-button ui-button--primary primary-login-button" type="button" onClick={onCommentSubmit}>
          <Send size={16} aria-hidden="true" />
          <span>등록</span>
        </button>
      </div>
      {status && (
        <p className="form-status" role="status">
          {status}
        </p>
      )}

      {isLoading ? (
        <div className="comment-empty-state">
          <strong>댓글을 불러오는 중입니다.</strong>
          <p>잠시만 기다려 주세요.</p>
        </div>
      ) : comments.length > 0 ? (
        <div className="comment-list">
          {comments.map((comment) => (
            <CommentItem
              comment={comment}
              editingState={editingState}
              key={comment.id}
              onCancelEdit={onCancelEdit}
              onChangeEditingBody={onChangeEditingBody}
              onCommentDelete={onCommentDelete}
              onCommentEdit={onCommentEdit}
              onCommentLike={onCommentLike}
              onStartEdit={onStartEdit}
            />
          ))}
          {hasMoreComments && (
            <button
              className="ui-button ui-button--ghost ghost-action-button"
              type="button"
              disabled={isLoadingMore}
              onClick={onLoadMore}
            >
              {isLoadingMore ? '불러오는 중' : '댓글 더보기'}
            </button>
          )}
        </div>
      ) : hasCommentLoadError ? (
        <div className="comment-empty-state comment-empty-state--error">
          <strong>댓글을 불러오지 못했습니다.</strong>
          <p>잠시 후 새로고침해서 다시 확인해 주세요.</p>
        </div>
      ) : (
        <div className="comment-empty-state">
          <strong>아직 댓글이 없어요.</strong>
          <p>첫 댓글로 따뜻한 반응을 남겨보세요.</p>
        </div>
      )}
    </section>
  )
}
