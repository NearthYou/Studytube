import { useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'
import { AppShell } from './components/AppShell'
import {
  INITIAL_COMMENTS,
  INITIAL_FOLLOWED_BY_USER,
  INITIAL_LIKED_BY_USER,
  INITIAL_POSTS,
  INITIAL_USERS,
} from './data/mockData'
import { BoardPage } from './pages/BoardPage'
import { ChatPage } from './pages/ChatPage'
import { LoginPage } from './pages/LoginPage'
import { MyPage } from './pages/MyPage'
import { PostDetailPage } from './pages/PostDetailPage'
import { ProfilePage } from './pages/ProfilePage'
import { SignupPage } from './pages/SignupPage'
import { WritePage } from './pages/WritePage'
import type { Comment, Post, User } from './types/community'
import { countDiscussion, getSummary } from './utils/community'

function App() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<User[]>(INITIAL_USERS)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS)
  const [commentsByPost, setCommentsByPost] = useState<Record<number, Comment[]>>(INITIAL_COMMENTS)
  const [likedByUser, setLikedByUser] = useState<Record<number, number[]>>(INITIAL_LIKED_BY_USER)
  const [followedByUser, setFollowedByUser] = useState<Record<number, number[]>>(INITIAL_FOLLOWED_BY_USER)

  const currentUser = users.find((user) => user.id === currentUserId) ?? null
  const likedPostIds = new Set(currentUser ? likedByUser[currentUser.id] ?? [] : [])
  const followedAuthorIds = new Set(currentUser ? followedByUser[currentUser.id] ?? [] : [])

  const postsWithMeta = posts.map((post) => ({
    ...post,
    discussionCount: countDiscussion(commentsByPost[post.id] ?? []),
    author: users.find((user) => user.id === post.authorId)!,
  }))

  const handleLogin = (userId: string, password: string) => {
    const matchedUser = users.find(
      (user) => user.userId === userId && user.password === password,
    )

    if (!matchedUser) {
      window.alert('아이디/비밀번호를 확인해주세요!')
      return
    }

    setCurrentUserId(matchedUser.id)
    navigate('/main')
  }

  const handleSignup = (payload: {
    name: string
    userId: string
    password: string
    email: string
    nickname: string
  }) => {
    setUsers((current) => [
      ...current,
      {
        id: Math.max(...current.map((user) => user.id)) + 1,
        userId: payload.userId,
        password: payload.password,
        name: payload.name,
        email: payload.email,
        nickname: payload.nickname,
        bio: '새로 가입한 사용자입니다.',
        location: '미정',
      },
    ])
  }

  const handleSignOut = () => {
    setCurrentUserId(null)
    navigate('/login')
  }

  const toggleLike = (postId: number) => {
    if (!currentUser) {
      return
    }

    setLikedByUser((current) => {
      const currentLikes = current[currentUser.id] ?? []
      const nextLikes = currentLikes.includes(postId)
        ? currentLikes.filter((id) => id !== postId)
        : [...currentLikes, postId]

      return {
        ...current,
        [currentUser.id]: nextLikes,
      }
    })
  }

  const toggleFollow = (authorId: number) => {
    if (!currentUser) {
      return
    }

    setFollowedByUser((current) => {
      const currentFollows = current[currentUser.id] ?? []
      const nextFollows = currentFollows.includes(authorId)
        ? currentFollows.filter((id) => id !== authorId)
        : [...currentFollows, authorId]

      return {
        ...current,
        [currentUser.id]: nextFollows,
      }
    })
  }

  const addComment = (postId: number, content: string) => {
    if (!currentUser) {
      return
    }

    const nextComment: Comment = {
      id: Date.now(),
      authorId: currentUser.id,
      content,
      createdAt: '방금 전',
      replies: [],
    }

    setCommentsByPost((current) => ({
      ...current,
      [postId]: [nextComment, ...(current[postId] ?? [])],
    }))
  }

  const addReply = (postId: number, commentId: number, content: string) => {
    if (!currentUser) {
      return
    }

    setCommentsByPost((current) => ({
      ...current,
      [postId]: (current[postId] ?? []).map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              replies: [
                ...comment.replies,
                {
                  id: Date.now(),
                  authorId: currentUser.id,
                  content,
                  createdAt: '방금 전',
                },
              ],
            }
          : comment,
      ),
    }))
  }

  const createPost = (payload: {
    title: string
    travelDate: string
    imageUrl: string
    region: string
    budget: string
    theme: string
    season: string
    companion: string
    content: string
  }) => {
    if (!currentUser) {
      return
    }

    const nextPost: Post = {
      id: Date.now(),
      title: payload.title,
      summary: getSummary(payload.content),
      content: payload.content,
      region: payload.region,
      budget: payload.budget,
      theme: payload.theme,
      season: payload.season,
      companion: payload.companion,
      createdAt: new Date().toISOString().slice(0, 10),
      travelDate: payload.travelDate,
      views: 0,
      imageUrl:
        payload.imageUrl ||
        'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
      tags: [`#${payload.region}`, `#${payload.theme}`, `#${payload.companion}`],
      authorId: currentUser.id,
    }

    setPosts((current) => [nextPost, ...current])
  }

  const incrementView = (postId: number) => {
    setPosts((current) =>
      current.map((post) => (post.id === postId ? { ...post, views: post.views + 1 } : post)),
    )
  }

  const updateProfile = (payload: { nickname: string; password: string }) => {
    if (!currentUser) {
      return false
    }

    const isDuplicatedNickname = users.some(
      (user) =>
        user.id !== currentUser.id &&
        user.nickname.toLowerCase() === payload.nickname.toLowerCase(),
    )

    if (isDuplicatedNickname) {
      return false
    }

    setUsers((current) =>
      current.map((user) =>
        user.id === currentUser.id
          ? { ...user, nickname: payload.nickname, password: payload.password }
          : user,
      ),
    )

    return true
  }

  return (
    <div className="app-shell">
      <AppShell currentUser={currentUser} onSignOut={handleSignOut} />
      <Routes>
        <Route
          path="/"
          element={<Navigate replace to={currentUser ? '/main' : '/login'} />}
        />
        <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
        <Route path="/signup" element={<SignupPage onSignup={handleSignup} users={users} />} />
        <Route
          path="/main"
          element={
            currentUser ? (
              <BoardPage
                currentUser={currentUser}
                likedPostIds={likedPostIds}
                onToggleLike={toggleLike}
                posts={postsWithMeta}
              />
            ) : (
              <Navigate replace to="/login" />
            )
          }
        />
        <Route
          path="/posts/:postId"
          element={
            currentUser ? (
              <PostDetailPage
                commentsByPost={commentsByPost}
                currentUser={currentUser}
                followedAuthorIds={followedAuthorIds}
                likedPostIds={likedPostIds}
                onAddComment={addComment}
                onAddReply={addReply}
                onIncrementView={incrementView}
                onToggleFollow={toggleFollow}
                onToggleLike={toggleLike}
                posts={postsWithMeta}
                users={users}
              />
            ) : (
              <Navigate replace to="/login" />
            )
          }
        />
        <Route
          path="/profile/:authorId"
          element={
            currentUser ? (
              <ProfilePage
                followedAuthorIds={followedAuthorIds}
                likedPostIds={likedPostIds}
                onToggleFollow={toggleFollow}
                onToggleLike={toggleLike}
                posts={postsWithMeta}
                users={users}
              />
            ) : (
              <Navigate replace to="/login" />
            )
          }
        />
        <Route
          path="/mypage"
          element={
            currentUser ? (
              <MyPage
                commentsByPost={commentsByPost}
                currentUser={currentUser}
                likedPostIds={likedPostIds}
                onUpdateProfile={updateProfile}
                posts={postsWithMeta}
              />
            ) : (
              <Navigate replace to="/login" />
            )
          }
        />
        <Route
          path="/write"
          element={
            currentUser ? <WritePage onCreatePost={createPost} /> : <Navigate replace to="/login" />
          }
        />
        <Route
          path="/chat"
          element={currentUser ? <ChatPage /> : <Navigate replace to="/login" />}
        />
      </Routes>
    </div>
  )
}

export default App
