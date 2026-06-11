import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Comment, PostWithMeta, User } from '../types/community'
import { createComment, createReply, fetchComments } from '../utils/commentsApi'
import { formatDate, getUserLabel } from '../utils/community'
import { fetchPostById } from '../utils/postsApi'
import '../styles/pages/PostDetailPage.css'

type PostDetailPageProps = {
  users: User[]
  posts: PostWithMeta[]
  likedPostIds: Set<number>
  followedAuthorIds: Set<number>
  onToggleLike: (postId: number) => void
  onToggleFollow: (authorId: number) => void
  onIncrementView: (postId: number) => void
  onHydratePosts: (posts: PostWithMeta[]) => void
}

export function PostDetailPage({
  users,
  posts,
  likedPostIds,
  followedAuthorIds,
  onToggleLike,
  onToggleFollow,
  onIncrementView,
  onHydratePosts,
}: PostDetailPageProps) {
  const params = useParams()
  const [post, setPost] = useState<PostWithMeta | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmittingComment, setIsSubmittingComment] = useState(false)
  const [submittingReplyFor, setSubmittingReplyFor] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const viewedPostIdsRef = useRef<Set<number>>(new Set())
  const postId = Number(params.postId)

  useEffect(() => {
    if (!Number.isFinite(postId)) {
      setIsLoading(false)
      setErrorMessage('잘못된 게시글 주소입니다.')
      return
    }

    let isMounted = true

    const loadDetail = async () => {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const [postResponse, commentsResponse] = await Promise.all([
          fetchPostById(postId),
          fetchComments(postId),
        ])

        if (!isMounted) {
          return
        }

        setPost(postResponse.post)
        setComments(commentsResponse.items)
        onHydratePosts([postResponse.post])
      } catch (error) {
        if (!isMounted) {
          return
        }

        setErrorMessage(error instanceof Error ? error.message : '게시글을 불러오지 못했습니다.')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadDetail()

    return () => {
      isMounted = false
    }
  }, [onHydratePosts, postId])

  useEffect(() => {
    if (!post || viewedPostIdsRef.current.has(post.id)) {
      return
    }

    viewedPostIdsRef.current.add(post.id)
    onIncrementView(post.id)
  }, [onIncrementView, post])

  if (isLoading) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>게시글을 불러오는 중입니다.</h1>
        </section>
      </main>
    )
  }

  if (errorMessage || !post) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>{errorMessage || '게시글을 찾을 수 없습니다.'}</h1>
          <Link className="secondary-button" to="/main">
            메인으로 돌아가기
          </Link>
        </section>
      </main>
    )
  }

  const relatedPosts = posts
    .filter((item) => item.region === post.region && item.id !== post.id)
    .slice(0, 3)
  const chatHref = `/chat?${new URLSearchParams({
    q: `${post.region} ${post.theme} ${post.companion} 여행 추천`,
    region: post.region,
    budget: post.budget,
    theme: post.theme,
    season: post.season,
    companion: post.companion,
    travelDate: post.travelDate,
  }).toString()}`
  const plannerHref = `/planner?${new URLSearchParams({
    q: `${post.region} 일정 추천`,
    region: post.region,
    budget: post.budget,
    theme: post.theme,
    season: post.season,
    companion: post.companion,
    travelDate: post.travelDate,
    duration: '3',
  }).toString()}`

  const renderedDiscussionCount = comments.reduce(
    (total, comment) => total + 1 + comment.replies.length,
    0,
  )

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
          <p className="detail-card__body">{post.content || '본문이 없는 게시글입니다.'}</p>
          <div className="detail-card__actions">
            <button type="button" onClick={() => onToggleLike(post.id)}>
              {likedPostIds.has(post.id) ? '좋아요 취소' : '좋아요'}
            </button>
            <button type="button" onClick={() => onToggleFollow(post.author.id)}>
              {followedAuthorIds.has(post.author.id) ? '팔로우 중' : '작성자 팔로우'}
            </button>
            <Link className="secondary-button" to={chatHref}>
              이 글 기반 추천
            </Link>
            <Link className="secondary-button" to={plannerHref}>
              이 글로 일정 만들기
            </Link>
          </div>
        </div>
      </article>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>댓글 {renderedDiscussionCount}</h2>
          <span>댓글과 대댓글을 바로 확인하고 작성할 수 있습니다.</span>
        </div>
        <form
          className="comment-form"
          onSubmit={async (event) => {
            event.preventDefault()
            const nextContent = commentText.trim()

            if (!nextContent) {
              return
            }

            setIsSubmittingComment(true)

            try {
              const response = await createComment(post.id, nextContent)
              setComments((current) => [response.comment, ...current])
              setCommentText('')
            } catch (error) {
              window.alert(error instanceof Error ? error.message : '댓글 등록에 실패했습니다.')
            } finally {
              setIsSubmittingComment(false)
            }
          }}
        >
          <textarea
            placeholder="이 게시글에 대한 의견을 남겨보세요."
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
          />
          <button className="primary-button" disabled={isSubmittingComment} type="submit">
            {isSubmittingComment ? '등록 중...' : '댓글 등록'}
          </button>
        </form>
        <div className="comment-list">
          {comments.map((comment) => (
            <article className="comment-card" key={comment.id}>
              <div className="comment-card__head">
                <strong>{comment.author?.nickname ?? getUserLabel(users, comment.authorId)}</strong>
                <span>{formatDate(comment.createdAt)}</span>
              </div>
              <p>{comment.content}</p>
              <div className="reply-list">
                {comment.replies.map((reply) => (
                  <div className="reply-card" key={reply.id}>
                    <strong>{reply.author?.nickname ?? getUserLabel(users, reply.authorId)}</strong>
                    <span>{formatDate(reply.createdAt)}</span>
                    <p>{reply.content}</p>
                  </div>
                ))}
              </div>
              <form
                className="reply-form"
                onSubmit={async (event) => {
                  event.preventDefault()
                  const draft = replyDrafts[comment.id]?.trim()

                  if (!draft) {
                    return
                  }

                  setSubmittingReplyFor(comment.id)

                  try {
                    const response = await createReply(comment.id, draft)
                    setComments((current) =>
                      current.map((item) =>
                        item.id === comment.id
                          ? {
                              ...item,
                              replies: [...item.replies, response.reply],
                            }
                          : item,
                      ),
                    )
                    setReplyDrafts((current) => ({ ...current, [comment.id]: '' }))
                  } catch (error) {
                    window.alert(error instanceof Error ? error.message : '답글 등록에 실패했습니다.')
                  } finally {
                    setSubmittingReplyFor(null)
                  }
                }}
              >
                <input
                  placeholder="답글을 입력하세요."
                  value={replyDrafts[comment.id] ?? ''}
                  onChange={(event) =>
                    setReplyDrafts((current) => ({
                      ...current,
                      [comment.id]: event.target.value,
                    }))
                  }
                />
                <button className="ghost-button" disabled={submittingReplyFor === comment.id} type="submit">
                  {submittingReplyFor === comment.id ? '등록 중...' : '답글 등록'}
                </button>
              </form>
            </article>
          ))}
          {!comments.length ? <p className="muted-copy">아직 댓글이 없습니다.</p> : null}
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>AI 연결 동선</h2>
          <span>게시글 기반 추천과 일정 생성을 바로 이어서 사용할 수 있습니다.</span>
        </div>
        <div className="detail-ai-links">
          <Link className="detail-ai-card" to={chatHref}>
            <strong>RAG 추천 시작</strong>
            <p>이 게시글 내용을 바탕으로 추천 흐름을 이어갑니다.</p>
          </Link>
          <Link className="detail-ai-card" to={plannerHref}>
            <strong>AI 플래너 열기</strong>
            <p>이 글을 참고해 일정 초안을 이어서 만듭니다.</p>
          </Link>
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>같은 지역 글</h2>
          <span>{post.region} 관련 추천 게시글</span>
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
          {!relatedPosts.length ? <p className="muted-copy">같은 지역의 다른 글은 아직 없습니다.</p> : null}
        </div>
      </section>
    </main>
  )
}
