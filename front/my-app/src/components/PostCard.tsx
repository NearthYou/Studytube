import { Link } from 'react-router'
import type { PostWithMeta } from '../types/community'
import { formatDate } from '../utils/community'
import '../styles/components/PostCard.css'

type PostCardProps = {
  post: PostWithMeta
  isLiked: boolean
  onToggleLike: (postId: number) => void
}

export function PostCard({ post, isLiked, onToggleLike }: PostCardProps) {
  return (
    <article className="post-card">
      <Link className="post-card__image-link" to={`/posts/${post.id}`}>
        <img alt={post.title} className="post-card__image" src={post.imageUrl} />
      </Link>
      <div className="post-card__body">
        <div className="post-card__meta">
          <span>{formatDate(post.createdAt)}</span>
          <span>{post.region}</span>
        </div>
        <h2 className="post-card__title">
          <Link to={`/posts/${post.id}`}>{post.title}</Link>
        </h2>
        <div className="post-card__tags">
          {post.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <p className="post-card__summary">{post.summary}</p>
        <div className="post-card__footer">
          <Link className="post-card__author" to={`/profile/${post.author.id}`}>
            {post.author.nickname}
          </Link>
          <div className="post-card__stats">
            <span>조회 {post.views}</span>
            <span>댓글 {post.discussionCount}</span>
            <button type="button" onClick={() => onToggleLike(post.id)}>
              {isLiked ? '좋아요 취소' : '좋아요'}
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
