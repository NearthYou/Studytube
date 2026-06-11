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
      setErrorMessage('Invalid post address.')
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

        setErrorMessage(error instanceof Error ? error.message : 'Failed to load post.')
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
          <h1>Loading post...</h1>
        </section>
      </main>
    )
  }

  if (errorMessage || !post) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>{errorMessage || 'Post not found.'}</h1>
          <Link className="secondary-button" to="/main">
            Back to Main
          </Link>
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
                  window.alert('Please fill in all required fields.')
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
                Title
                <input
                  value={editPostForm.title}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>
              <label>
                Travel Date
                <input
                  type="date"
                  value={editPostForm.travelDate}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, travelDate: event.target.value }))
                  }
                />
              </label>
              <label>
                Image URL
                <input
                  value={editPostForm.imageUrl}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, imageUrl: event.target.value }))
                  }
                />
              </label>
              <div className="detail-edit-grid">
                <FilterSelect
                  label="Region"
                  options={lookupOptions.regions}
                  value={editPostForm.regionCode}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, regionCode: value }))
                  }
                />
                <FilterSelect
                  label="Budget"
                  options={lookupOptions.budgetRanges}
                  value={editPostForm.budgetCode}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, budgetCode: value }))
                  }
                />
                <FilterSelect
                  label="Theme"
                  options={lookupOptions.themes}
                  value={editPostForm.themeCode}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, themeCode: value }))
                  }
                />
                <FilterSelect
                  label="Season"
                  options={lookupOptions.seasons}
                  value={editPostForm.season}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, season: value }))
                  }
                />
                <FilterSelect
                  label="Companion"
                  options={lookupOptions.companions}
                  value={editPostForm.companion}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, companion: value }))
                  }
                />
              </div>
              <label>
                Content
                <textarea
                  value={editPostForm.content}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, content: event.target.value }))
                  }
                />
              </label>
              <div className="detail-inline-actions">
                <button className="primary-button" disabled={isSavingPostEdit} type="submit">
                  {isSavingPostEdit ? 'Saving...' : 'Save Post'}
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
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1>{post.title}</h1>
              <p className="detail-card__author">
                Author <Link to={`/profile/${post.author.id}`}>{post.author.nickname}</Link>
              </p>
              <div className="detail-card__tags">
                {post.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <p className="detail-card__body">{post.content || 'No content.'}</p>
            </>
          )}

          <div className="detail-card__actions">
            <button type="button" onClick={() => void onToggleLike(post.id)}>
              {likedPostIds.has(post.id) ? 'Remove Bookmark' : 'Bookmark'}
            </button>
            <button type="button" onClick={() => void onToggleFollow(post.author.id)}>
              {followedAuthorIds.has(post.author.id) ? 'Unfollow Author' : 'Follow Author'}
            </button>
            <Link className="secondary-button" to={chatHref}>
              Recommendation Bot
            </Link>
            <Link className="secondary-button" to={plannerHref}>
              Travel Planner
            </Link>
            {isAuthor ? (
              <>
                <button type="button" onClick={() => setIsEditingPost((current) => !current)}>
                  {isEditingPost ? 'Close Edit' : 'Edit Post'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('Delete this post?')) {
                      return
                    }

                    const success = await onDeletePost(post.id)

                    if (success) {
                      navigate('/main')
                    }
                  }}
                >
                  Delete Post
                </button>
              </>
            ) : null}
          </div>
        </div>
      </article>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>Comments {renderedDiscussionCount}</h2>
          <span>Read and write comments in this post.</span>
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
              window.alert(error instanceof Error ? error.message : 'Failed to create comment.')
            } finally {
              setIsSubmittingComment(false)
            }
          }}
        >
          <textarea
            placeholder="Write a comment."
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
          />
          <button className="primary-button" disabled={isSubmittingComment} type="submit">
            {isSubmittingComment ? 'Saving...' : 'Add Comment'}
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
                    <em className="detail-edited-badge">edited</em>
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
                      window.alert(error instanceof Error ? error.message : 'Failed to update comment.')
                    }
                  }}
                >
                  <textarea
                    value={editingCommentText}
                    onChange={(event) => setEditingCommentText(event.target.value)}
                  />
                  <div className="detail-inline-actions">
                    <button className="ghost-button" type="submit">
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCommentId(null)
                        setEditingCommentText('')
                      }}
                    >
                      Cancel
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
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('Delete this comment?')) {
                        return
                      }

                      try {
                        await deleteComment(comment.id)
                        setComments((current) => current.filter((item) => item.id !== comment.id))
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : 'Failed to delete comment.')
                      }
                    }}
                  >
                    Delete
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
                        <em className="detail-edited-badge">edited</em>
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
                            window.alert(error instanceof Error ? error.message : 'Failed to update reply.')
                          }
                        }}
                      >
                        <textarea
                          value={editingReplyText}
                          onChange={(event) => setEditingReplyText(event.target.value)}
                        />
                        <div className="detail-inline-actions">
                          <button className="ghost-button" type="submit">
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingReplyId(null)
                              setEditingReplyText('')
                            }}
                          >
                            Cancel
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
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm('Delete this reply?')) {
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
                              window.alert(error instanceof Error ? error.message : 'Failed to delete reply.')
                            }
                          }}
                        >
                          Delete
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
                    window.alert(error instanceof Error ? error.message : 'Failed to create reply.')
                  } finally {
                    setSubmittingReplyFor(null)
                  }
                }}
              >
                <input
                  placeholder="Write a reply."
                  value={replyDrafts[comment.id] ?? ''}
                  onChange={(event) =>
                    setReplyDrafts((current) => ({
                      ...current,
                      [comment.id]: event.target.value,
                    }))
                  }
                />
                <button className="ghost-button" disabled={submittingReplyFor === comment.id} type="submit">
                  {submittingReplyFor === comment.id ? 'Saving...' : 'Add Reply'}
                </button>
              </form>
            </article>
          ))}
          {!comments.length ? <p className="muted-copy">No comments yet.</p> : null}
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>AI Shortcuts</h2>
          <span>Move directly to recommendation and planner flows from this post.</span>
        </div>
        <div className="detail-ai-links">
          <Link className="detail-ai-card" to={chatHref}>
            <strong>Start RAG Recommendation</strong>
            <p>Use this post as context for travel recommendations.</p>
          </Link>
          <Link className="detail-ai-card" to={plannerHref}>
            <strong>Open Planner</strong>
            <p>Draft a travel plan based on this post.</p>
          </Link>
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>Related Posts</h2>
          <span>More posts from {post.region}</span>
        </div>
        <div className="related-posts">
          {relatedPosts.map((relatedPost) => (
            <Link className="related-post" key={relatedPost.id} to={`/posts/${relatedPost.id}`}>
              <strong>{relatedPost.title}</strong>
              <span>
                Views {relatedPost.views} | Comments {relatedPost.discussionCount}
              </span>
            </Link>
          ))}
          {!relatedPosts.length ? <p className="muted-copy">No related posts yet.</p> : null}
        </div>
      </section>
    </main>
  )
}
