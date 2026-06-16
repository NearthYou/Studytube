import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { CommentActivity, PostWithMeta, User } from '../types/community'
import { formatCalendarDate, formatRelativeTime } from '../utils/community'
import type { Language } from '../utils/language'
import { fetchMyBookmarks, fetchMyComments, fetchMyFollows, fetchMyPosts, type FollowUser } from '../utils/meApi'
import '../styles/pages/MyPage.css'

type MyPageProps = {
  currentUser: User
  onUpdateProfile: (payload: {
    currentPassword: string
    nickname: string
    password: string
    passwordConfirm: string
    bio: string
    location: string
  }) => Promise<boolean>
  onVerifyCurrentPassword: (currentPassword: string) => Promise<boolean>
  language: Language
}

type MyPageTab = 'posts' | 'likes' | 'comments' | 'follows' | 'profile'

const POST_LIMIT = 15
const COMMENT_LIMIT = 20
const FOLLOW_LIMIT = 20

const COPY = {
  ko: {
    banner: '마이페이지',
    noBio: '아직 소개글이 없습니다.',
    posts: '내가 쓴 글',
    likes: '저장한 글',
    comments: '내 댓글',
    follows: '팔로우 목록',
    profile: '내 정보 수정',
    loading: '불러오는 중...',
    noPosts: '아직 작성한 글이 없습니다.',
    noLikes: '아직 저장한 글이 없습니다.',
    noComments: '아직 작성한 댓글이 없습니다.',
    noFollows: '아직 팔로우한 사용자가 없습니다.',
    views: '조회',
    commentType: '댓글',
    replyType: '답글',
    previous: '이전',
    next: '다음',
    nickname: '닉네임',
    currentPassword: '현재 비밀번호',
    currentPasswordPlaceholder: '회원 정보를 수정하려면 현재 비밀번호를 입력하세요.',
    newPassword: '새 비밀번호',
    passwordPlaceholder: '변경하지 않으면 비워 두세요.',
    bio: '소개글',
    location: '지역',
    save: '저장하기',
    saving: '저장 중...',
    name: '이름',
    email: '이메일',
    enterNickname: '닉네임을 입력해 주세요.',
    enterCurrentPassword: '현재 비밀번호를 입력해 주세요.',
    profileSaved: '회원 정보가 수정되었습니다.',
    loadFailed: '마이페이지 정보를 불러오지 못했습니다.',
  },
  en: {
    banner: 'My Page',
    noBio: 'No bio yet.',
    posts: 'My posts',
    likes: 'Saved posts',
    comments: 'My comments',
    follows: 'Following',
    profile: 'Edit profile',
    loading: 'Loading...',
    noPosts: 'No posts yet.',
    noLikes: 'No saved posts yet.',
    noComments: 'No comments yet.',
    noFollows: 'You are not following anyone yet.',
    views: 'Views',
    commentType: 'Comment',
    replyType: 'Reply',
    previous: 'Previous',
    next: 'Next',
    nickname: 'Nickname',
    currentPassword: 'Current password',
    currentPasswordPlaceholder: 'Enter your current password to save changes.',
    newPassword: 'New password',
    passwordPlaceholder: 'Leave blank to keep the current password.',
    bio: 'Bio',
    location: 'Location',
    save: 'Save',
    saving: 'Saving...',
    name: 'Name',
    email: 'Email',
    enterNickname: 'Enter a nickname.',
    enterCurrentPassword: 'Enter your current password.',
    profileSaved: 'Profile updated.',
    loadFailed: 'Failed to load My Page data.',
  },
} satisfies Record<Language, Record<string, string>>

export function MyPage({ currentUser, onUpdateProfile, onVerifyCurrentPassword, language }: MyPageProps) {
  const copy = COPY[language]
  const [tab, setTab] = useState<MyPageTab>('posts')
  const [nickname, setNickname] = useState(currentUser.nickname)
  const [currentPassword, setCurrentPassword] = useState('')
  const [verifiedCurrentPassword, setVerifiedCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [bio, setBio] = useState(currentUser.bio)
  const [location, setLocation] = useState(currentUser.location)
  const [myPosts, setMyPosts] = useState<PostWithMeta[]>([])
  const [likedPosts, setLikedPosts] = useState<PostWithMeta[]>([])
  const [myComments, setMyComments] = useState<CommentActivity[]>([])
  const [followUsers, setFollowUsers] = useState<FollowUser[]>([])
  const [pages, setPages] = useState({
    posts: 1,
    likes: 1,
    comments: 1,
    follows: 1,
  })
  const [totalPages, setTotalPages] = useState({
    posts: 1,
    likes: 1,
    comments: 1,
    follows: 1,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false)
  const verifyPasswordLabel = language === 'ko' ? '확인' : 'Confirm'
  const verifyingPasswordLabel = language === 'ko' ? '확인 중...' : 'Checking...'
  const passwordConfirmLabel = language === 'ko' ? '새 비밀번호 확인' : 'Confirm new password'
  const passwordConfirmPlaceholder =
    language === 'ko' ? '새 비밀번호를 한 번 더 입력하세요.' : 'Enter the new password again.'
  const enterPasswordConfirmMessage =
    language === 'ko' ? '새 비밀번호 확인을 입력해 주세요.' : 'Confirm the new password.'
  const passwordMismatchMessage =
    language === 'ko' ? '새 비밀번호가 일치하지 않습니다.' : 'New passwords do not match.'

  useEffect(() => {
    queueMicrotask(() => {
      setNickname(currentUser.nickname)
      setBio(currentUser.bio)
      setLocation(currentUser.location)
      setCurrentPassword('')
      setVerifiedCurrentPassword('')
      setPassword('')
      setPasswordConfirm('')
    })
  }, [currentUser.bio, currentUser.location, currentUser.nickname])

  useEffect(() => {
    if (tab === 'profile') {
      queueMicrotask(() => setIsLoading(false))
      return
    }

    let isMounted = true

    const loadCurrentTab = async () => {
      setIsLoading(true)

      try {
        if (tab === 'posts') {
          const response = await fetchMyPosts({
            page: pages.posts,
            limit: POST_LIMIT,
          })

          if (!isMounted) {
            return
          }

          setMyPosts(response.items)
          setTotalPages((current) => ({ ...current, posts: response.totalPages }))
        }

        if (tab === 'likes') {
          const response = await fetchMyBookmarks({
            page: pages.likes,
            limit: POST_LIMIT,
          })

          if (!isMounted) {
            return
          }

          setLikedPosts(response.items)
          setTotalPages((current) => ({ ...current, likes: response.totalPages }))
        }

        if (tab === 'comments') {
          const response = await fetchMyComments({
            page: pages.comments,
            limit: COMMENT_LIMIT,
          })

          if (!isMounted) {
            return
          }

          setMyComments(response.items)
          setTotalPages((current) => ({ ...current, comments: response.totalPages }))
        }

        if (tab === 'follows') {
          const response = await fetchMyFollows({
            page: pages.follows,
            limit: FOLLOW_LIMIT,
          })

          if (!isMounted) {
            return
          }

          setFollowUsers(response.items)
          setTotalPages((current) => ({ ...current, follows: response.totalPages }))
        }
      } catch (error) {
        if (isMounted) {
          window.alert(error instanceof Error ? error.message : copy.loadFailed)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadCurrentTab()

    return () => {
      isMounted = false
    }
  }, [copy.loadFailed, pages.comments, pages.follows, pages.likes, pages.posts, tab])

  const renderPagination = (key: 'posts' | 'likes' | 'comments' | 'follows') => {
    const currentPage = pages[key]
    const currentTotalPages = totalPages[key]

    if (currentTotalPages <= 1) {
      return null
    }

    return (
      <div className="mypage-pagination">
        <button
          disabled={currentPage <= 1}
          type="button"
          onClick={() =>
            setPages((current) => ({
              ...current,
              [key]: Math.max(1, current[key] - 1),
            }))
          }
        >
          {copy.previous}
        </button>
        <span>
          {currentPage} / {currentTotalPages}
        </span>
        <button
          disabled={currentPage >= currentTotalPages}
          type="button"
          onClick={() =>
            setPages((current) => ({
              ...current,
              [key]: Math.min(currentTotalPages, current[key] + 1),
            }))
          }
        >
          {copy.next}
        </button>
      </div>
    )
  }

  return (
    <main className="page mypage-page">
      <section className="profile-banner">
        <span>{copy.banner}</span>
        <h1>{currentUser.nickname}</h1>
        <p>{currentUser.bio || copy.noBio}</p>
      </section>

      <section className="mypage-tabs">
        <button className={tab === 'posts' ? 'active' : ''} type="button" onClick={() => setTab('posts')}>
          {copy.posts}
        </button>
        <button className={tab === 'likes' ? 'active' : ''} type="button" onClick={() => setTab('likes')}>
          {copy.likes}
        </button>
        <button className={tab === 'comments' ? 'active' : ''} type="button" onClick={() => setTab('comments')}>
          {copy.comments}
        </button>
        <button className={tab === 'follows' ? 'active' : ''} type="button" onClick={() => setTab('follows')}>
          {copy.follows}
        </button>
        <button className={tab === 'profile' ? 'active' : ''} type="button" onClick={() => setTab('profile')}>
          {copy.profile}
        </button>
      </section>

      {tab === 'posts' ? (
        <section className="mypage-panel">
          {isLoading ? <p className="muted-copy">{copy.loading}</p> : null}
          {!isLoading && myPosts.length
            ? myPosts.map((post) => (
                <Link className="mypage-item" key={post.id} to={`/posts/${post.id}`}>
                  <strong>{post.title}</strong>
                  <span>
                    {post.region} | {formatCalendarDate(post.travelDate, language)}
                  </span>
                </Link>
              ))
            : null}
          {!isLoading && !myPosts.length ? <p className="muted-copy">{copy.noPosts}</p> : null}
          {renderPagination('posts')}
        </section>
      ) : null}

      {tab === 'likes' ? (
        <section className="mypage-panel">
          {isLoading ? <p className="muted-copy">{copy.loading}</p> : null}
          {!isLoading && likedPosts.length
            ? likedPosts.map((post) => (
                <Link className="mypage-item" key={post.id} to={`/posts/${post.id}`}>
                  <strong>{post.title}</strong>
                  <span>
                    {post.author.nickname} | {copy.views} {post.views}
                  </span>
                </Link>
              ))
            : null}
          {!isLoading && !likedPosts.length ? <p className="muted-copy">{copy.noLikes}</p> : null}
          {renderPagination('likes')}
        </section>
      ) : null}

      {tab === 'comments' ? (
        <section className="mypage-panel">
          {isLoading ? <p className="muted-copy">{copy.loading}</p> : null}
          {!isLoading && myComments.length
            ? myComments.map((entry) => (
                <Link className="mypage-item" key={`${entry.type}-${entry.id}`} to={`/posts/${entry.postId}`}>
                  <strong>{entry.type === 'comment' ? copy.commentType : copy.replyType}</strong>
                  <span>{entry.content}</span>
                  <small>
                    {entry.postTitle} | {formatRelativeTime(entry.createdAt, language)}
                  </small>
                </Link>
              ))
            : null}
          {!isLoading && !myComments.length ? <p className="muted-copy">{copy.noComments}</p> : null}
          {renderPagination('comments')}
        </section>
      ) : null}

      {tab === 'follows' ? (
        <section className="mypage-panel">
          {isLoading ? <p className="muted-copy">{copy.loading}</p> : null}
          {!isLoading && followUsers.length
            ? followUsers.map((user) => (
                <Link className="mypage-item" key={user.id} to={`/profile/${user.id}`}>
                  <strong>{user.nickname}</strong>
                  <span>{user.bio || user.name}</span>
                </Link>
              ))
            : null}
          {!isLoading && !followUsers.length ? <p className="muted-copy">{copy.noFollows}</p> : null}
          {renderPagination('follows')}
        </section>
      ) : null}

      {tab === 'profile' ? (
        <section className="mypage-panel">
          {!verifiedCurrentPassword ? (
            <form
              className="profile-edit-form"
              onSubmit={async (event) => {
                event.preventDefault()

                if (!currentPassword.trim()) {
                  window.alert(copy.enterCurrentPassword)
                  return
                }

                setIsVerifyingPassword(true)

                try {
                  const success = await onVerifyCurrentPassword(currentPassword)

                  if (!success) {
                    return
                  }

                  setVerifiedCurrentPassword(currentPassword)
                  setCurrentPassword('')
                } finally {
                  setIsVerifyingPassword(false)
                }
              }}
            >
              <label>
                {copy.currentPassword}
                <input
                  autoComplete="current-password"
                  placeholder={copy.currentPasswordPlaceholder}
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={isVerifyingPassword} type="submit">
                {isVerifyingPassword ? verifyingPasswordLabel : verifyPasswordLabel}
              </button>
            </form>
          ) : (
            <form
              className="profile-edit-form"
              onSubmit={async (event) => {
                event.preventDefault()

                if (!nickname.trim()) {
                  window.alert(copy.enterNickname)
                  return
                }

                if (password.trim() && !passwordConfirm.trim()) {
                  window.alert(enterPasswordConfirmMessage)
                  return
                }

                if (password.trim() !== passwordConfirm.trim()) {
                  window.alert(passwordMismatchMessage)
                  return
                }

                setIsSubmitting(true)

                try {
                  const success = await onUpdateProfile({
                    currentPassword: verifiedCurrentPassword,
                    nickname: nickname.trim(),
                    password: password.trim(),
                    passwordConfirm: passwordConfirm.trim(),
                    bio: bio.trim(),
                    location: location.trim(),
                  })

                  if (!success) {
                    return
                  }

                  setVerifiedCurrentPassword('')
                  setCurrentPassword('')
                  setPassword('')
                  setPasswordConfirm('')
                  window.alert(copy.profileSaved)
                } finally {
                  setIsSubmitting(false)
                }
              }}
            >
              <label>
                {copy.nickname}
                <input value={nickname} onChange={(event) => setNickname(event.target.value)} />
              </label>
              <label>
                {copy.newPassword}
                <input
                  autoComplete="new-password"
                  placeholder={copy.passwordPlaceholder}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                {passwordConfirmLabel}
                <input
                  autoComplete="new-password"
                  placeholder={passwordConfirmPlaceholder}
                  type="password"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                />
              </label>
              <label>
                {copy.bio}
                <textarea value={bio} onChange={(event) => setBio(event.target.value)} />
              </label>
              <label>
                {copy.location}
                <input value={location} onChange={(event) => setLocation(event.target.value)} />
              </label>
              <button className="primary-button" disabled={isSubmitting} type="submit">
                {isSubmitting ? copy.saving : copy.save}
              </button>
            </form>
          )}
        </section>
      ) : null}
    </main>
  )
}
