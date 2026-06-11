import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { CommentActivity, PostWithMeta, User } from '../types/community'
import {
  fetchMyBookmarks,
  fetchMyComments,
  fetchMyFollows,
  fetchMyPosts,
  type FollowUser,
} from '../utils/meApi'
import '../styles/pages/MyPage.css'

type MyPageProps = {
  currentUser: User
  onUpdateProfile: (payload: {
    nickname: string
    password: string
    bio: string
    location: string
  }) => Promise<boolean>
}

type MyPageTab = 'posts' | 'likes' | 'comments' | 'follows' | 'profile'

const POST_LIMIT = 15
const COMMENT_LIMIT = 20
const FOLLOW_LIMIT = 20

export function MyPage({ currentUser, onUpdateProfile }: MyPageProps) {
  const [tab, setTab] = useState<MyPageTab>('posts')
  const [nickname, setNickname] = useState(currentUser.nickname)
  const [password, setPassword] = useState('')
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

  useEffect(() => {
    setNickname(currentUser.nickname)
    setBio(currentUser.bio)
    setLocation(currentUser.location)
  }, [currentUser.bio, currentUser.location, currentUser.nickname])

  useEffect(() => {
    if (tab === 'profile') {
      setIsLoading(false)
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
          window.alert(error instanceof Error ? error.message : 'Failed to load my page.')
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
  }, [pages.comments, pages.follows, pages.likes, pages.posts, tab])

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
          Previous
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
          Next
        </button>
      </div>
    )
  }

  return (
    <main className="page mypage-page">
      <section className="profile-banner">
        <span>MYPAGE</span>
        <h1>{currentUser.nickname}</h1>
        <p>{currentUser.bio || 'No bio yet.'}</p>
      </section>

      <section className="mypage-tabs">
        <button className={tab === 'posts' ? 'active' : ''} type="button" onClick={() => setTab('posts')}>
          My Posts
        </button>
        <button className={tab === 'likes' ? 'active' : ''} type="button" onClick={() => setTab('likes')}>
          Bookmarks
        </button>
        <button className={tab === 'comments' ? 'active' : ''} type="button" onClick={() => setTab('comments')}>
          My Comments
        </button>
        <button className={tab === 'follows' ? 'active' : ''} type="button" onClick={() => setTab('follows')}>
          Following
        </button>
        <button className={tab === 'profile' ? 'active' : ''} type="button" onClick={() => setTab('profile')}>
          Edit Profile
        </button>
      </section>

      {tab === 'posts' ? (
        <section className="mypage-panel">
          {isLoading ? <p className="muted-copy">Loading...</p> : null}
          {!isLoading && myPosts.length
            ? myPosts.map((post) => (
                <Link className="mypage-item" key={post.id} to={`/posts/${post.id}`}>
                  <strong>{post.title}</strong>
                  <span>
                    {post.region} | {post.travelDate}
                  </span>
                </Link>
              ))
            : null}
          {!isLoading && !myPosts.length ? <p className="muted-copy">No posts yet.</p> : null}
          {renderPagination('posts')}
        </section>
      ) : null}

      {tab === 'likes' ? (
        <section className="mypage-panel">
          {isLoading ? <p className="muted-copy">Loading...</p> : null}
          {!isLoading && likedPosts.length
            ? likedPosts.map((post) => (
                <Link className="mypage-item" key={post.id} to={`/posts/${post.id}`}>
                  <strong>{post.title}</strong>
                  <span>
                    {post.author.nickname} | Views {post.views}
                  </span>
                </Link>
              ))
            : null}
          {!isLoading && !likedPosts.length ? <p className="muted-copy">No bookmarks yet.</p> : null}
          {renderPagination('likes')}
        </section>
      ) : null}

      {tab === 'comments' ? (
        <section className="mypage-panel">
          {isLoading ? <p className="muted-copy">Loading...</p> : null}
          {!isLoading && myComments.length
            ? myComments.map((entry) => (
                <Link className="mypage-item" key={`${entry.type}-${entry.id}`} to={`/posts/${entry.postId}`}>
                  <strong>{entry.type === 'comment' ? 'Comment' : 'Reply'}</strong>
                  <span>{entry.content}</span>
                  <small>
                    {entry.postTitle} | {entry.createdAt}
                  </small>
                </Link>
              ))
            : null}
          {!isLoading && !myComments.length ? <p className="muted-copy">No comments yet.</p> : null}
          {renderPagination('comments')}
        </section>
      ) : null}

      {tab === 'follows' ? (
        <section className="mypage-panel">
          {isLoading ? <p className="muted-copy">Loading...</p> : null}
          {!isLoading && followUsers.length
            ? followUsers.map((user) => (
                <Link className="mypage-item" key={user.id} to={`/profile/${user.id}`}>
                  <strong>{user.nickname}</strong>
                  <span>{user.bio || user.name}</span>
                </Link>
              ))
            : null}
          {!isLoading && !followUsers.length ? (
            <p className="muted-copy">You are not following anyone yet.</p>
          ) : null}
          {renderPagination('follows')}
        </section>
      ) : null}

      {tab === 'profile' ? (
        <section className="mypage-panel">
          <form
            className="profile-edit-form"
            onSubmit={async (event) => {
              event.preventDefault()

              if (!nickname.trim()) {
                window.alert('Nickname is required.')
                return
              }

              setIsSubmitting(true)

              try {
                const success = await onUpdateProfile({
                  nickname: nickname.trim(),
                  password: password.trim(),
                  bio: bio.trim(),
                  location: location.trim(),
                })

                if (!success) {
                  return
                }

                setPassword('')
                window.alert('Profile updated.')
              } finally {
                setIsSubmitting(false)
              }
            }}
          >
            <label>
              Name
              <input disabled value={currentUser.name} />
            </label>
            <label>
              Email
              <input disabled value={currentUser.email} />
            </label>
            <label>
              Nickname
              <input value={nickname} onChange={(event) => setNickname(event.target.value)} />
            </label>
            <label>
              New Password
              <input
                placeholder="Leave blank to keep current password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              Bio
              <textarea value={bio} onChange={(event) => setBio(event.target.value)} />
            </label>
            <label>
              Location
              <input value={location} onChange={(event) => setLocation(event.target.value)} />
            </label>
            <button className="primary-button" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  )
}
