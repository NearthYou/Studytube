import { ArrowLeft, Heart, MessageCircle, Pencil, Trash2 } from 'lucide-react'
import type { Post } from '../../types/post'
import { appPaths, getTagPath } from '../../utils/paths'
import { SafeImage } from '../common/SafeImage'

type PostDetailArticleProps = {
  commentCount: number
  onPostLike: () => void
  post: Post
  returnPath: string
}

export function PostDetailArticle({ commentCount, onPostLike, post, returnPath }: PostDetailArticleProps) {
  return (
    <article className="board-panel post-detail-panel">
      <div className="detail-media">
        <SafeImage
          src={post.detailImageUrl}
          alt={post.imageAlt}
          fallbackAlt="Tail Talk 기본 게시글 이미지"
          sizes="(min-width: 1024px) 960px, 100vw"
          srcSet={post.imageSrcSet || undefined}
        />
      </div>

      <div className="detail-content">
        <a className="back-link" href={returnPath}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>목록으로</span>
        </a>
        <p className="feed-kicker">게시글 상세</p>
        <h1>{post.title}</h1>
        <div className="detail-meta">
          <span>{post.author}</span>
          <span>{post.time}</span>
          <span>조회 {post.views.toLocaleString('ko-KR')}</span>
        </div>
        {post.tags.length > 0 && (
          <nav className="detail-tag-list" aria-label="게시글 태그">
            {post.tags.map((tag) => (
              <a className="post-tag-chip" href={getTagPath(tag.name)} key={tag.id}>
                #{tag.name}
              </a>
            ))}
          </nav>
        )}

        <div className="detail-engagement-row" aria-label="게시글 반응">
          <button
            className={post.likedByMe ? 'like-button is-liked' : 'like-button'}
            type="button"
            aria-label={post.likedByMe ? '게시글 좋아요 취소' : '게시글 좋아요'}
            aria-pressed={post.likedByMe}
            onClick={onPostLike}
          >
            <Heart className="like-icon" size={18} aria-hidden="true" />
            <span className="like-count">{post.likeCount}</span>
          </button>
          <a className="comment-jump-button" href="#detail-comments">
            <MessageCircle size={18} aria-hidden="true" />
            <span>댓글 {commentCount}</span>
          </a>
        </div>

        <p className="detail-body detail-body--plain">{post.body}</p>

        {post.isOwner && (
          <div className="detail-action-row">
            <a className="ui-button ui-button--ghost ghost-action-button" href={appPaths.postEdit(post.id)}>
              <Pencil size={16} aria-hidden="true" />
              <span>수정</span>
            </a>
            <a className="ui-button ui-button--danger danger-action-button" href={appPaths.postDelete(post.id)}>
              <Trash2 size={16} aria-hidden="true" />
              <span>삭제</span>
            </a>
          </div>
        )}
      </div>
    </article>
  )
}
