import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { FilterSelect } from '../components/FilterSelect'
import type { Comment, PostWithMeta, User } from '../types/community'
import {
  createComment,
  createReply,
  deleteComment,
  deleteReply,
  fetchComments,
  updateComment,
  updateReply,
} from '../utils/commentsApi'
import { formatDate, getUserLabel } from '../utils/community'
import { fetchPostFilters, type PostFilterLookups } from '../utils/lookupsApi'
import { fetchPostById } from '../utils/postsApi'
import '../styles/pages/PostDetailPage.css'

type PostDetailPageProps = {
  currentUser: User
  users: User[]
  posts: PostWithMeta[]
  likedPostIds: Set<number>
  followedAuthorIds: Set<number>
  onToggleLike: (postId: number) => void
  onToggleFollow: (authorId: number) => void
  onIncrementView: (postId: number) => void
  onHydratePosts: (posts: PostWithMeta[]) => void
  onDeletePost: (postId: number) => Promise<boolean>
  onUpdatePost: (
    postId: number,
    payload: {
      title: string
      travelDate: string
      imageUrl: string
      regionCode: string
      budgetCode: string
      themeCode: string
      season: string
      companion: string
      content: string
    },
  ) => Promise<boolean>
}

const EMPTY_LOOKUPS: PostFilterLookups = {
  regions: [],
  themes: [],
  budgetRanges: [],
  seasons: [],
  companions: [],
}

function isEdited(createdAt?: string, updatedAt?: string) {
  if (!createdAt || !updatedAt) {
    return false
  }

  return new Date(updatedAt).getTime() > new Date(createdAt).getTime()
}

export function PostDetailPage({
  currentUser,
  users,
  posts,
  likedPostIds,
  followedAuthorIds,
  onToggleLike,
  onToggleFollow,
  onIncrementView,
  onHydratePosts,
  onDeletePost,
  onUpdatePost,
}: PostDetailPageProps) {
  const params = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState<PostWithMeta | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  const [editingReplyText, setEditingReplyText] = useState('')
  const [isEditingPost, setIsEditingPost] = useState(false)
  const [lookupOptions, setLookupOptions] = useState<PostFilterLookups>(EMPTY_LOOKUPS)
  const [editPostForm, setEditPostForm] = useState({
    title: '',
    travelDate: '',
    imageUrl: '',
    regionCode: '',
    budgetCode: '',
    themeCode: '',
    season: '',
    companion: '',
    content: '',
  })
  const [isSavingPostEdit, setIsSavingPostEdit] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmittingComment, setIsSubmittingComment] = useState(false)
  const [submittingReplyFor, setSubmittingReplyFor] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const viewedPostIdsRef = useRef<Set<number>>(new Set())
  const postId = Number(params.postId)

  useEffect(() => {
    let isMounted = true

    const loadLookups = async () => {
      try {
        const data = await fetchPostFilters()

        if (!isMounted) {
          return
        }

        setLookupOptions(data)
      } catch {
        if (!isMounted) {
          return
        }
      }
    }

    void loadLookups()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!Number.isFinite(postId)) {
      setIsLoading(false)
      setErrorMessage('?섎せ??寃뚯떆湲 二쇱냼?낅땲??')
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
        setEditPostForm({
          title: postResponse.post.title,
          travelDate: postResponse.post.travelDate,
          imageUrl: postResponse.post.imageUrl,
          regionCode: postResponse.post.regionCode ?? '',
          budgetCode: postResponse.post.budgetCode ?? '',
          themeCode: postResponse.post.themeCode ?? '',
          season: postResponse.post.season,
          companion: postResponse.post.companion,
          content: postResponse.post.content,
        })
        setComments(commentsResponse.items)
        onHydratePosts([postResponse.post])
      } catch (error) {
        if (!isMounted) {
          return
        }

        setErrorMessage(error instanceof Error ? error.message : '寃뚯떆湲??遺덈윭?ㅼ? 紐삵뻽?듬땲??')
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
          <h1>寃뚯떆湲??遺덈윭?ㅻ뒗 以묒엯?덈떎...</h1>
        </section>
      </main>
    )
  }

  if (errorMessage || !post) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>{errorMessage || '寃뚯떆湲??李얠쓣 ???놁뒿?덈떎.'}</h1>
          <Link className="secondary-button" to="/main">
            硫붿씤?쇰줈 ?뚯븘媛湲?          </Link>
        </section>
      </main>
    )
  }

  const isAuthor = currentUser.id === post.author.id
  const relatedPosts = posts.filter((item) => item.region === post.region && item.id !== post.id).slice(0, 3)
  const chatHref = `/chat?${new URLSearchParams({
    q: `${post.region} ${post.theme} ${post.companion} recommendation`,
    region: post.region,
    budget: post.budget,
    theme: post.theme,
    season: post.season,
    companion: post.companion,
    travelDate: post.travelDate,
  }).toString()}`
  const plannerHref = `/planner?${new URLSearchParams({
    q: `${post.region} planner`,
    region: post.region,
    budget: post.budget,
    theme: post.theme,
    season: post.season,
    companion: post.companion,
    travelDate: post.travelDate,
    duration: '3',
  }).toString()}`

  const renderedDiscussionCount = comments.reduce((total, comment) => total + 1 + comment.replies.length, 0)

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

          {isEditingPost ? (
            <form
              className="detail-edit-form"
              onSubmit={async (event) => {
                event.preventDefault()

                if (
                  !editPostForm.title.trim() ||
                  !editPostForm.travelDate ||
                  !editPostForm.regionCode ||
                  !editPostForm.budgetCode ||
                  !editPostForm.themeCode ||
                  !editPostForm.season ||
                  !editPostForm.companion ||
                  !editPostForm.content.trim()
                ) {
                  window.alert('?꾩닔 ??ぉ??紐⑤몢 ?낅젰?댁＜?몄슂.')
                  return
                }

                setIsSavingPostEdit(true)

                try {
                  const success = await onUpdatePost(post.id, {
                    title: editPostForm.title.trim(),
                    travelDate: editPostForm.travelDate,
                    imageUrl: editPostForm.imageUrl.trim(),
                    regionCode: editPostForm.regionCode,
                    budgetCode: editPostForm.budgetCode,
                    themeCode: editPostForm.themeCode,
                    season: editPostForm.season,
                    companion: editPostForm.companion,
                    content: editPostForm.content.trim(),
                  })

                  if (!success) {
                    return
                  }

                  const refreshed = await fetchPostById(post.id)
                  setPost(refreshed.post)
                  setEditPostForm({
                    title: refreshed.post.title,
                    travelDate: refreshed.post.travelDate,
                    imageUrl: refreshed.post.imageUrl,
                    regionCode: refreshed.post.regionCode ?? '',
                    budgetCode: refreshed.post.budgetCode ?? '',
                    themeCode: refreshed.post.themeCode ?? '',
                    season: refreshed.post.season,
                    companion: refreshed.post.companion,
                    content: refreshed.post.content,
                  })
                  onHydratePosts([refreshed.post])
                  setIsEditingPost(false)
                } finally {
                  setIsSavingPostEdit(false)
                }
              }}
            >
              <label>
                ?쒕ぉ
                <input
                  value={editPostForm.title}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>
              <label>
                ?ы뻾?쇱옄
                <input
                  type="date"
                  value={editPostForm.travelDate}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, travelDate: event.target.value }))
                  }
                />
              </label>
              <label>
                ?대?吏 URL
                <input
                  value={editPostForm.imageUrl}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, imageUrl: event.target.value }))
                  }
                />
              </label>
              <div className="detail-edit-grid">
                <FilterSelect
                  label="지역"
                  options={lookupOptions.regions}
                  value={editPostForm.regionCode}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, regionCode: value }))
                  }
                />
                <FilterSelect
                  label="예산"
                  options={lookupOptions.budgetRanges}
                  value={editPostForm.budgetCode}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, budgetCode: value }))
                  }
                />
                <FilterSelect
                  label="테마"
                  options={lookupOptions.themes}
                  value={editPostForm.themeCode}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, themeCode: value }))
                  }
                />
                <FilterSelect
                  label="계절"
                  options={lookupOptions.seasons}
                  value={editPostForm.season}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, season: value }))
                  }
                />
                <FilterSelect
                  label="동행"
                  options={lookupOptions.companions}
                  value={editPostForm.companion}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, companion: value }))
                  }
                />
              </div>
              <label>
                ?댁슜
                <textarea
                  value={editPostForm.content}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, content: event.target.value }))
                  }
                />
              </label>
              <div className="detail-inline-actions">
                <button className="primary-button" disabled={isSavingPostEdit} type="submit">
                  {isSavingPostEdit ? '저장 중...' : '게시글 저장'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditPostForm({
                      title: post.title,
                      travelDate: post.travelDate,
                      imageUrl: post.imageUrl,
                      regionCode: post.regionCode ?? '',
                      budgetCode: post.budgetCode ?? '',
                      themeCode: post.themeCode ?? '',
                      season: post.season,
                      companion: post.companion,
                      content: post.content,
                    })
                    setIsEditingPost(false)
                  }}
                >
                  痍⑥냼
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1>{post.title}</h1>
              <p className="detail-card__author">
                ?묒꽦??<Link to={`/profile/${post.author.id}`}>{post.author.nickname}</Link>
              </p>
              <div className="detail-card__tags">
                {post.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <p className="detail-card__body">{post.content || '?댁슜???놁뒿?덈떎.'}</p>
            </>
          )}

          <div className="detail-card__actions">
            <button
              aria-label={likedPostIds.has(post.id) ? '찜 취소' : '찜하기'}
              className={`like-button ${likedPostIds.has(post.id) ? 'active' : ''}`}
              title={likedPostIds.has(post.id) ? '찜 취소' : '찜하기'}
              type="button"
              onClick={() => void onToggleLike(post.id)}
            >
              <span aria-hidden="true" className="like-button__heart">
                {likedPostIds.has(post.id) ? '♥' : '♡'}
              </span>
            </button>
            <button type="button" onClick={() => void onToggleFollow(post.author.id)}>
              {followedAuthorIds.has(post.author.id) ? '팔로우 취소' : '작성자 팔로우'}
            </button>
            <Link className="secondary-button" to={chatHref}>
              추천 챗봇
            </Link>
            <Link className="secondary-button" to={plannerHref}>
              여행 플래너
            </Link>
            {isAuthor ? (
              <>
                <button type="button" onClick={() => setIsEditingPost((current) => !current)}>
                  {isEditingPost ? '?섏젙 ?リ린' : '寃뚯떆湲 ?섏젙'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('??寃뚯떆湲????젣?좉퉴??')) {
                      return
                    }

                    const success = await onDeletePost(post.id)

                    if (success) {
                      navigate('/main')
                    }
                  }}
                >
                  寃뚯떆湲 ??젣
                </button>
              </>
            ) : null}
          </div>
        </div>
      </article>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>?볤? {renderedDiscussionCount}</h2>
          <span>??寃뚯떆湲???볤?怨???볤????뺤씤?섍퀬 ?묒꽦?????덉뒿?덈떎.</span>
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
              window.alert(error instanceof Error ? error.message : '?볤????깅줉?섏? 紐삵뻽?듬땲??')
            } finally {
              setIsSubmittingComment(false)
            }
          }}
        >
          <textarea
            placeholder="?볤????낅젰?섏꽭??"
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
          />
          <button className="primary-button" disabled={isSubmittingComment} type="submit">
            {isSubmittingComment ? '???以?..' : '?볤? ?깅줉'}
          </button>
        </form>
        <div className="comment-list">
          {comments.map((comment) => (
            <article className="comment-card" key={comment.id}>
              <div className="comment-card__head">
                <strong>{comment.author?.nickname ?? getUserLabel(users, comment.authorId)}</strong>
                <span>
                  {formatDate(comment.createdAt)}
                  {isEdited(comment.createdAt, comment.updatedAt) ? (
                    <em className="detail-edited-badge">수정됨</em>
                  ) : null}
                </span>
              </div>

              {editingCommentId === comment.id ? (
                <form
                  className="detail-edit-inline-form"
                  onSubmit={async (event) => {
                    event.preventDefault()
                    const nextContent = editingCommentText.trim()

                    if (!nextContent) {
                      return
                    }

                    try {
                      const response = await updateComment(comment.id, nextContent)
                      setComments((current) =>
                        current.map((item) => (item.id === comment.id ? { ...item, ...response.comment } : item)),
                      )
                      setEditingCommentId(null)
                      setEditingCommentText('')
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : '?볤????섏젙?섏? 紐삵뻽?듬땲??')
                    }
                  }}
                >
                  <textarea
                    value={editingCommentText}
                    onChange={(event) => setEditingCommentText(event.target.value)}
                  />
                  <div className="detail-inline-actions">
                    <button className="ghost-button" type="submit">
                      ???                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCommentId(null)
                        setEditingCommentText('')
                      }}
                    >
                      痍⑥냼
                    </button>
                  </div>
                </form>
              ) : (
                <p>{comment.content}</p>
              )}

              {comment.authorId === currentUser.id ? (
                <div className="detail-inline-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCommentId(comment.id)
                      setEditingCommentText(comment.content)
                    }}
                  >
                    ?섏젙
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('???볤?????젣?좉퉴??')) {
                        return
                      }

                      try {
                        await deleteComment(comment.id)
                        setComments((current) => current.filter((item) => item.id !== comment.id))
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : '?볤?????젣?섏? 紐삵뻽?듬땲??')
                      }
                    }}
                  >
                    ??젣
                  </button>
                </div>
              ) : null}

              <div className="reply-list">
                {comment.replies.map((reply) => (
                  <div className="reply-card" key={reply.id}>
                    <strong>{reply.author?.nickname ?? getUserLabel(users, reply.authorId)}</strong>
                    <span>
                      {formatDate(reply.createdAt)}
                      {isEdited(reply.createdAt, reply.updatedAt) ? (
                        <em className="detail-edited-badge">수정됨</em>
                      ) : null}
                    </span>

                    {editingReplyId === reply.id ? (
                      <form
                        className="detail-edit-inline-form"
                        onSubmit={async (event) => {
                          event.preventDefault()
                          const nextContent = editingReplyText.trim()

                          if (!nextContent) {
                            return
                          }

                          try {
                            const response = await updateReply(reply.id, nextContent)
                            setComments((current) =>
                              current.map((item) =>
                                item.id === comment.id
                                  ? {
                                      ...item,
                                      replies: item.replies.map((entry) =>
                                        entry.id === reply.id ? { ...entry, ...response.reply } : entry,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                            setEditingReplyId(null)
                            setEditingReplyText('')
                          } catch (error) {
                            window.alert(error instanceof Error ? error.message : '??볤????섏젙?섏? 紐삵뻽?듬땲??')
                          }
                        }}
                      >
                        <textarea
                          value={editingReplyText}
                          onChange={(event) => setEditingReplyText(event.target.value)}
                        />
                        <div className="detail-inline-actions">
                          <button className="ghost-button" type="submit">
                            ???                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingReplyId(null)
                              setEditingReplyText('')
                            }}
                          >
                            痍⑥냼
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p>{reply.content}</p>
                    )}

                    {reply.authorId === currentUser.id ? (
                      <div className="detail-inline-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingReplyId(reply.id)
                            setEditingReplyText(reply.content)
                          }}
                        >
                          ?섏젙
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm('????볤?????젣?좉퉴??')) {
                              return
                            }

                            try {
                              await deleteReply(reply.id)
                              setComments((current) =>
                                current.map((item) =>
                                  item.id === comment.id
                                    ? {
                                        ...item,
                                        replies: item.replies.filter((entry) => entry.id !== reply.id),
                                      }
                                    : item,
                                ),
                              )
                            } catch (error) {
                              window.alert(error instanceof Error ? error.message : '??볤?????젣?섏? 紐삵뻽?듬땲??')
                            }
                          }}
                        >
                          ??젣
                        </button>
                      </div>
                    ) : null}
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
                    window.alert(error instanceof Error ? error.message : '??볤????깅줉?섏? 紐삵뻽?듬땲??')
                  } finally {
                    setSubmittingReplyFor(null)
                  }
                }}
              >
                <input
                  placeholder="??볤????낅젰?섏꽭??"
                  value={replyDrafts[comment.id] ?? ''}
                  onChange={(event) =>
                    setReplyDrafts((current) => ({
                      ...current,
                      [comment.id]: event.target.value,
                    }))
                  }
                />
                <button className="ghost-button" disabled={submittingReplyFor === comment.id} type="submit">
                  {submittingReplyFor === comment.id ? '???以?..' : '??볤? ?깅줉'}
                </button>
              </form>
            </article>
          ))}
          {!comments.length ? <p className="muted-copy">?꾩쭅 ?볤????놁뒿?덈떎.</p> : null}
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>바로가기</h2>
          <span>이 게시글을 기준으로 추천 챗봇과 플래너로 바로 이동할 수 있습니다.</span>
        </div>
        <div className="detail-ai-links">
          <Link className="detail-ai-card" to={chatHref}>
            <strong>추천 챗봇 열기</strong>
            <p>이 게시글을 기준으로 여행지를 추천받습니다.</p>
          </Link>
          <Link className="detail-ai-card" to={plannerHref}>
            <strong>플래너 열기</strong>
            <p>이 게시글을 바탕으로 일정 초안을 만듭니다.</p>
          </Link>
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>연관 게시글</h2>
          <span>{post.region} 지역의 다른 게시글</span>
        </div>
        <div className="related-posts">
          {relatedPosts.map((relatedPost) => (
            <Link className="related-post" key={relatedPost.id} to={`/posts/${relatedPost.id}`}>
              <strong>{relatedPost.title}</strong>
              <span>
                조회 {relatedPost.views} | 댓글 {relatedPost.discussionCount}
              </span>
            </Link>
          ))}
          {!relatedPosts.length ? <p className="muted-copy">연관 게시글이 아직 없습니다.</p> : null}
        </div>
      </section>
    </main>
  )
}
