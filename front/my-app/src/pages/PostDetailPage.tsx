import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Comment, PostWithMeta, User } from '../types/community'
import { formatDate, getUserLabel } from '../utils/community'
import '../styles/pages/PostDetailPage.css'

type PostDetailPageProps = {
  currentUser: User
  users: User[]
  posts: PostWithMeta[]
  commentsByPost: Record<number, Comment[]>
  likedPostIds: Set<number>
  followedAuthorIds: Set<number>
  onToggleLike: (postId: number) => void
  onToggleFollow: (authorId: number) => void
  onAddComment: (postId: number, content: string) => void
  onAddReply: (postId: number, commentId: number, content: string) => void
  onIncrementView: (postId: number) => void
}

export function PostDetailPage({
  users,
  posts,
  commentsByPost,
  likedPostIds,
  followedAuthorIds,
  onToggleLike,
  onToggleFollow,
  onAddComment,
  onAddReply,
  onIncrementView,
}: PostDetailPageProps) {
  const params = useParams()
  const [commentText, setCommentText] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const postId = Number(params.postId)
  const post = posts.find((item) => item.id === postId)

  useEffect(() => {
    if (post) {
      onIncrementView(post.id)
    }
  }, [post, onIncrementView])

  if (!post) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>게시글을 찾을 수 없습니다.</h1>
          <Link className="secondary-button" to="/main">
            메인으로 돌아가기
          </Link>
        </section>
      </main>
    )
  }

  const comments = commentsByPost[post.id] ?? []
  const relatedPosts = posts
    .filter((item) => item.region === post.region && item.id !== post.id)
    .slice(0, 3)

  return (
    <main className="page detail-page">
      <article className="detail-card">
        <div className="detail-card__media">
          <img alt={post.title} src={post.imageUrl} />
        </div>
        <div className="detail-card__content">
          <div className="detail-card__meta">
            <span>{formatDate(post.createdAt)}</span>
            <span>{post.region}</span>
            <span>{post.travelDate}</span>
          </div>
          <h1>{post.title}</h1>
          <p className="detail-card__author">
            작성자 <Link to={`/profile/${post.author.id}`}>{post.author.nickname}</Link>
          </p>
          <div className="detail-card__tags">
            {post.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <p className="detail-card__body">{post.content}</p>
          <div className="detail-card__actions">
            <button type="button" onClick={() => onToggleLike(post.id)}>
              {likedPostIds.has(post.id) ? '좋아요 취소' : '좋아요'}
            </button>
            <button type="button" onClick={() => onToggleFollow(post.author.id)}>
              {followedAuthorIds.has(post.author.id) ? '팔로우 중' : '작성자 팔로우'}
            </button>
          </div>
        </div>
      </article>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>댓글 {post.discussionCount}</h2>
          <span>댓글과 대댓글을 이어서 확인할 수 있습니다.</span>
        </div>
        <form
          className="comment-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!commentText.trim()) {
              return
            }
            onAddComment(post.id, commentText.trim())
            setCommentText('')
          }}
        >
          <textarea
            placeholder="이 게시글에 대한 의견을 남겨보세요."
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
          />
          <button className="primary-button" type="submit">
            댓글 등록
          </button>
        </form>
        <div className="comment-list">
          {comments.map((comment) => (
            <article className="comment-card" key={comment.id}>
              <div className="comment-card__head">
                <strong>{getUserLabel(users, comment.authorId)}</strong>
                <span>{comment.createdAt}</span>
              </div>
              <p>{comment.content}</p>
              <div className="reply-list">
                {comment.replies.map((reply) => (
                  <div className="reply-card" key={reply.id}>
                    <strong>{getUserLabel(users, reply.authorId)}</strong>
                    <span>{reply.createdAt}</span>
                    <p>{reply.content}</p>
                  </div>
                ))}
              </div>
              <form
                className="reply-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  const draft = replyDrafts[comment.id]?.trim()
                  if (!draft) {
                    return
                  }
                  onAddReply(post.id, comment.id, draft)
                  setReplyDrafts((current) => ({ ...current, [comment.id]: '' }))
                }}
              >
                <input
                  placeholder="대댓글을 입력하세요"
                  value={replyDrafts[comment.id] ?? ''}
                  onChange={(event) =>
                    setReplyDrafts((current) => ({
                      ...current,
                      [comment.id]: event.target.value,
                    }))
                  }
                />
                <button className="ghost-button" type="submit">
                  답글 등록
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>같은 지역 글</h2>
          <span>{post.region} 기준 추천</span>
        </div>
        <div className="related-posts">
          {relatedPosts.map((relatedPost) => (
            <Link className="related-post" key={relatedPost.id} to={`/posts/${relatedPost.id}`}>
              <strong>{relatedPost.title}</strong>
              <span>
                조회 {relatedPost.views} · 댓글 {relatedPost.discussionCount}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
