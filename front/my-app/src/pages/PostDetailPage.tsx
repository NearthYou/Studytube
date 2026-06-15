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
import { localizeLookupOptions, localizeLookupValue } from '../utils/i18n'
import type { Language } from '../utils/language'
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
  language: Language
}

const EMPTY_LOOKUPS: PostFilterLookups = {
  regions: [],
  themes: [],
  budgetRanges: [],
  seasons: [],
  companions: [],
}

const COPY = {
  ko: {
    invalidAddress: '잘못된 게시글 주소입니다.',
    loadFailed: '게시글을 불러오지 못했습니다.',
    loading: '게시글을 불러오는 중입니다...',
    notFound: '게시글을 찾을 수 없습니다.',
    backToMain: '메인으로 돌아가기',
    required: '필수 항목을 모두 입력해주세요.',
    title: '제목',
    travelDate: '여행일자',
    imageUrl: '이미지 URL',
    region: '지역',
    budget: '예산',
    theme: '테마',
    season: '계절',
    companion: '동행',
    content: '내용',
    savePost: '게시글 저장',
    savingPost: '저장 중...',
    cancel: '취소',
    author: '작성자',
    noContent: '내용이 없습니다.',
    like: '찜하기',
    unlike: '찜 취소',
    followAuthor: '작성자 팔로우',
    unfollowAuthor: '팔로우 취소',
    openChat: '추천 챗봇',
    openPlanner: '여행 플래너',
    editPost: '게시글 수정',
    closeEdit: '수정 닫기',
    deletePost: '게시글 삭제',
    confirmDeletePost: '이 게시글을 삭제할까요?',
    comments: '댓글',
    commentIntro: '',
    commentPlaceholder: '댓글을 입력하세요',
    submitComment: '댓글 등록',
    submitting: '저장 중...',
    edited: '수정됨',
    edit: '수정',
    delete: '삭제',
    save: '저장',
    confirmDeleteComment: '이 댓글을 삭제할까요?',
    confirmDeleteReply: '이 답글을 삭제할까요?',
    replyPlaceholder: '답글을 입력하세요',
    submitReply: '답글 등록',
    noComments: '아직 댓글이 없습니다.',
    shortcuts: 'AI 도구',
    shortcutsBody: '',
    openChatTitle: 'AI 추천',
    openChatBody: '',
    openPlannerTitle: '일정 만들기',
    openPlannerBody: '',
    relatedPosts: '연관 게시글',
    relatedPostsBody: '지역의 다른 게시글',
    noRelatedPosts: '연관 게시글이 아직 없습니다.',
    views: '조회',
    discussion: '댓글',
    commentCreateFailed: '댓글을 등록하지 못했습니다.',
    commentUpdateFailed: '댓글을 수정하지 못했습니다.',
    commentDeleteFailed: '댓글을 삭제하지 못했습니다.',
    replyCreateFailed: '답글을 등록하지 못했습니다.',
    replyUpdateFailed: '답글을 수정하지 못했습니다.',
    replyDeleteFailed: '답글을 삭제하지 못했습니다.',
  },
  en: {
    invalidAddress: 'Invalid post address.',
    loadFailed: 'Failed to load the post.',
    loading: 'Loading post...',
    notFound: 'Post not found.',
    backToMain: 'Back to home',
    required: 'Fill in every required field.',
    title: 'Title',
    travelDate: 'Travel date',
    imageUrl: 'Image URL',
    region: 'Region',
    budget: 'Budget',
    theme: 'Theme',
    season: 'Season',
    companion: 'Companion',
    content: 'Content',
    savePost: 'Save post',
    savingPost: 'Saving...',
    cancel: 'Cancel',
    author: 'Author',
    noContent: 'No content yet.',
    like: 'Save',
    unlike: 'Unsave',
    followAuthor: 'Follow author',
    unfollowAuthor: 'Unfollow',
    openChat: 'Chat',
    openPlanner: 'Planner',
    editPost: 'Edit post',
    closeEdit: 'Close editor',
    deletePost: 'Delete post',
    confirmDeletePost: 'Delete this post?',
    comments: 'Comments',
    commentIntro: '',
    commentPlaceholder: 'Write a comment',
    submitComment: 'Post comment',
    submitting: 'Saving...',
    edited: 'Edited',
    edit: 'Edit',
    delete: 'Delete',
    save: 'Save',
    confirmDeleteComment: 'Delete this comment?',
    confirmDeleteReply: 'Delete this reply?',
    replyPlaceholder: 'Write a reply',
    submitReply: 'Post reply',
    noComments: 'No comments yet.',
    shortcuts: 'AI tools',
    shortcutsBody: '',
    openChatTitle: 'Ask AI',
    openChatBody: '',
    openPlannerTitle: 'Create plan',
    openPlannerBody: '',
    relatedPosts: 'Related posts',
    relatedPostsBody: 'other posts in this region',
    noRelatedPosts: 'No related posts yet.',
    views: 'Views',
    discussion: 'Comments',
    commentCreateFailed: 'Failed to create the comment.',
    commentUpdateFailed: 'Failed to update the comment.',
    commentDeleteFailed: 'Failed to delete the comment.',
    replyCreateFailed: 'Failed to create the reply.',
    replyUpdateFailed: 'Failed to update the reply.',
    replyDeleteFailed: 'Failed to delete the reply.',
  },
} satisfies Record<Language, Record<string, string>>

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
  language,
}: PostDetailPageProps) {
  const copy = COPY[language]
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
      setErrorMessage(copy.invalidAddress)
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

        setErrorMessage(error instanceof Error ? error.message : copy.loadFailed)
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
  }, [copy.invalidAddress, copy.loadFailed, onHydratePosts, postId])

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
          <h1>{copy.loading}</h1>
        </section>
      </main>
    )
  }

  if (errorMessage || !post) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>{errorMessage || copy.notFound}</h1>
          <Link className="secondary-button" to="/main">
            {copy.backToMain}
          </Link>
        </section>
      </main>
    )
  }

  const localizedLookups: PostFilterLookups = {
    regions: localizeLookupOptions('region', lookupOptions.regions, language),
    themes: localizeLookupOptions('theme', lookupOptions.themes, language),
    budgetRanges: localizeLookupOptions('budget', lookupOptions.budgetRanges, language),
    seasons: localizeLookupOptions('season', lookupOptions.seasons, language),
    companions: localizeLookupOptions('companion', lookupOptions.companions, language),
  }

  const isAuthor = currentUser.id === post.author.id
  const relatedPosts = posts.filter((item) => item.region === post.region && item.id !== post.id).slice(0, 3)
  const region = localizeLookupValue('region', post.region, language, post.regionCode)
  const budget = localizeLookupValue('budget', post.budget, language, post.budgetCode)
  const theme = localizeLookupValue('theme', post.theme, language, post.themeCode)
  const season = localizeLookupValue('season', post.season, language)
  const companion = localizeLookupValue('companion', post.companion, language)
  const chatHref = `/chat?${new URLSearchParams({
    q:
      language === 'ko'
        ? `${region} ${theme} ${companion} 여행 추천`
        : `Recommend a ${theme.toLowerCase()} trip in ${region} for ${companion.toLowerCase()}.`,
    region,
    budget,
    theme,
    season,
    companion,
    travelDate: post.travelDate,
  }).toString()}`
  const plannerHref = `/planner?${new URLSearchParams({
    q:
      language === 'ko'
        ? `${region} 여행 일정`
        : `Plan a trip in ${region}.`,
    region,
    budget,
    theme,
    season,
    companion,
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
            <span>{formatDate(post.createdAt, language)}</span>
            <span>{region}</span>
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
                  window.alert(copy.required)
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
                {copy.title}
                <input
                  value={editPostForm.title}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>
              <label>
                {copy.travelDate}
                <input
                  type="date"
                  value={editPostForm.travelDate}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, travelDate: event.target.value }))
                  }
                />
              </label>
              <label>
                {copy.imageUrl}
                <input
                  value={editPostForm.imageUrl}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, imageUrl: event.target.value }))
                  }
                />
              </label>
              <div className="detail-edit-grid">
                <FilterSelect
                  label={copy.region}
                  options={localizedLookups.regions}
                  value={editPostForm.regionCode}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, regionCode: value }))
                  }
                />
                <FilterSelect
                  label={copy.budget}
                  options={localizedLookups.budgetRanges}
                  value={editPostForm.budgetCode}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, budgetCode: value }))
                  }
                />
                <FilterSelect
                  label={copy.theme}
                  options={localizedLookups.themes}
                  value={editPostForm.themeCode}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, themeCode: value }))
                  }
                />
                <FilterSelect
                  label={copy.season}
                  options={localizedLookups.seasons}
                  value={editPostForm.season}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, season: value }))
                  }
                />
                <FilterSelect
                  label={copy.companion}
                  options={localizedLookups.companions}
                  value={editPostForm.companion}
                  onChange={(value) =>
                    setEditPostForm((current) => ({ ...current, companion: value }))
                  }
                />
              </div>
              <label>
                {copy.content}
                <textarea
                  value={editPostForm.content}
                  onChange={(event) =>
                    setEditPostForm((current) => ({ ...current, content: event.target.value }))
                  }
                />
              </label>
              <div className="detail-inline-actions">
                <button className="primary-button" disabled={isSavingPostEdit} type="submit">
                  {isSavingPostEdit ? copy.savingPost : copy.savePost}
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
                  {copy.cancel}
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1>{post.title}</h1>
              <p className="detail-card__author">
                {copy.author} <Link to={`/profile/${post.author.id}`}>{post.author.nickname}</Link>
              </p>
              <div className="detail-card__tags">
                {post.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <p className="detail-card__body">{post.content || copy.noContent}</p>
            </>
          )}

          <div className="detail-card__actions">
            <button
              aria-label={likedPostIds.has(post.id) ? copy.unlike : copy.like}
              className={`like-button ${likedPostIds.has(post.id) ? 'active' : ''}`}
              title={likedPostIds.has(post.id) ? copy.unlike : copy.like}
              type="button"
              onClick={() => void onToggleLike(post.id)}
            >
              <span aria-hidden="true" className="like-button__heart">
                {likedPostIds.has(post.id) ? '♥' : '♡'}
              </span>
            </button>
            <button type="button" onClick={() => void onToggleFollow(post.author.id)}>
              {followedAuthorIds.has(post.author.id) ? copy.unfollowAuthor : copy.followAuthor}
            </button>
            <Link className="secondary-button" to={chatHref}>
              {copy.openChat}
            </Link>
            <Link className="secondary-button" to={plannerHref}>
              {copy.openPlanner}
            </Link>
            {isAuthor ? (
              <>
                <button type="button" onClick={() => setIsEditingPost((current) => !current)}>
                  {isEditingPost ? copy.closeEdit : copy.editPost}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(copy.confirmDeletePost)) {
                      return
                    }

                    const success = await onDeletePost(post.id)

                    if (success) {
                      navigate('/main')
                    }
                  }}
                >
                  {copy.deletePost}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </article>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>{copy.comments} {renderedDiscussionCount}</h2>
          {copy.commentIntro ? <span>{copy.commentIntro}</span> : null}
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
              window.alert(error instanceof Error ? error.message : copy.commentCreateFailed)
            } finally {
              setIsSubmittingComment(false)
            }
          }}
        >
          <textarea
            placeholder={copy.commentPlaceholder}
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
          />
          <button className="primary-button" disabled={isSubmittingComment} type="submit">
            {isSubmittingComment ? copy.submitting : copy.submitComment}
          </button>
        </form>
        <div className="comment-list">
          {comments.map((comment) => (
            <article className="comment-card" key={comment.id}>
              <div className="comment-card__head">
                <strong>{comment.author?.nickname ?? getUserLabel(users, comment.authorId, language)}</strong>
                <span>
                  {formatDate(comment.createdAt, language)}
                  {isEdited(comment.createdAt, comment.updatedAt) ? (
                    <em className="detail-edited-badge">{copy.edited}</em>
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
                      window.alert(error instanceof Error ? error.message : copy.commentUpdateFailed)
                    }
                  }}
                >
                  <textarea
                    value={editingCommentText}
                    onChange={(event) => setEditingCommentText(event.target.value)}
                  />
                  <div className="detail-inline-actions">
                    <button className="ghost-button" type="submit">
                      {copy.save}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCommentId(null)
                        setEditingCommentText('')
                      }}
                    >
                      {copy.cancel}
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
                    {copy.edit}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(copy.confirmDeleteComment)) {
                        return
                      }

                      try {
                        await deleteComment(comment.id)
                        setComments((current) => current.filter((item) => item.id !== comment.id))
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : copy.commentDeleteFailed)
                      }
                    }}
                  >
                    {copy.delete}
                  </button>
                </div>
              ) : null}

              <div className="reply-list">
                {comment.replies.map((reply) => (
                  <div className="reply-card" key={reply.id}>
                    <strong>{reply.author?.nickname ?? getUserLabel(users, reply.authorId, language)}</strong>
                    <span>
                      {formatDate(reply.createdAt, language)}
                      {isEdited(reply.createdAt, reply.updatedAt) ? (
                        <em className="detail-edited-badge">{copy.edited}</em>
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
                            window.alert(error instanceof Error ? error.message : copy.replyUpdateFailed)
                          }
                        }}
                      >
                        <textarea
                          value={editingReplyText}
                          onChange={(event) => setEditingReplyText(event.target.value)}
                        />
                        <div className="detail-inline-actions">
                          <button className="ghost-button" type="submit">
                            {copy.save}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingReplyId(null)
                              setEditingReplyText('')
                            }}
                          >
                            {copy.cancel}
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
                          {copy.edit}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(copy.confirmDeleteReply)) {
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
                              window.alert(error instanceof Error ? error.message : copy.replyDeleteFailed)
                            }
                          }}
                        >
                          {copy.delete}
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
                    window.alert(error instanceof Error ? error.message : copy.replyCreateFailed)
                  } finally {
                    setSubmittingReplyFor(null)
                  }
                }}
              >
                <input
                  placeholder={copy.replyPlaceholder}
                  value={replyDrafts[comment.id] ?? ''}
                  onChange={(event) =>
                    setReplyDrafts((current) => ({
                      ...current,
                      [comment.id]: event.target.value,
                    }))
                  }
                />
                <button className="ghost-button" disabled={submittingReplyFor === comment.id} type="submit">
                  {submittingReplyFor === comment.id ? copy.submitting : copy.submitReply}
                </button>
              </form>
            </article>
          ))}
          {!comments.length ? <p className="muted-copy">{copy.noComments}</p> : null}
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>{copy.shortcuts}</h2>
          {copy.shortcutsBody ? <span>{copy.shortcutsBody}</span> : null}
        </div>
        <div className="detail-ai-links">
          <Link className="detail-ai-card" to={chatHref}>
            <strong>{copy.openChatTitle}</strong>
            {copy.openChatBody ? <p>{copy.openChatBody}</p> : null}
          </Link>
          <Link className="detail-ai-card" to={plannerHref}>
            <strong>{copy.openPlannerTitle}</strong>
            {copy.openPlannerBody ? <p>{copy.openPlannerBody}</p> : null}
          </Link>
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__heading">
          <h2>{copy.relatedPosts}</h2>
          <span>{region} {copy.relatedPostsBody}</span>
        </div>
        <div className="related-posts">
          {relatedPosts.map((relatedPost) => (
            <Link className="related-post" key={relatedPost.id} to={`/posts/${relatedPost.id}`}>
              <strong>{relatedPost.title}</strong>
              <span>
                {copy.views} {relatedPost.views} | {copy.discussion} {relatedPost.discussionCount}
              </span>
            </Link>
          ))}
          {!relatedPosts.length ? <p className="muted-copy">{copy.noRelatedPosts}</p> : null}
        </div>
      </section>
    </main>
  )
}
