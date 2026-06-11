import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'
import { AppShell } from './components/AppShell'
import {
  INITIAL_FOLLOWED_BY_USER,
  INITIAL_LIKED_BY_USER,
  INITIAL_POSTS,
  INITIAL_USERS,
} from './data/mockData'
import { BoardPage } from './pages/BoardPage'
import { ChatPage } from './pages/ChatPage'
import { LoginPage } from './pages/LoginPage'
import { MyPage } from './pages/MyPage'
import { PlannerPage } from './pages/PlannerPage'
import { PostDetailPage } from './pages/PostDetailPage'
import { ProfilePage } from './pages/ProfilePage'
import { SignupPage } from './pages/SignupPage'
import { WritePage } from './pages/WritePage'
import type { Post, PostWithMeta, User } from './types/community'
import {
  clearAuthToken,
  fetchMe,
  getAuthToken,
  isLoginIdAvailable,
  isNicknameAvailable,
  loginUser,
  logoutUser,
  requestEmailVerification,
  signupUser,
  type AuthApiUser,
} from './utils/authApi'
import { fetchMyBookmarks, fetchMyFollows, updateMyProfile as updateMyProfileApi } from './utils/meApi'
import {
  createPost as createPostApi,
  deletePost as deletePostApi,
  incrementPostView,
  updatePost as updatePostApi,
} from './utils/postsApi'
import { addBookmark, followUser, removeBookmark, unfollowUser } from './utils/socialApi'

type SignupPayload = {
  name: string
  userId: string
  password: string
  passwordConfirm: string
  email: string
  nickname: string
}

function mapAuthUserToCommunityUser(user: AuthApiUser): User {
  return {
    id: user.id,
    userId: user.loginId,
    password: '',
    name: user.name,
    email: user.email,
    nickname: user.nickname,
    bio: user.bio ?? '',
    location: user.location ?? '',
  }
}

function mapPostAuthorToCommunityUser(author: PostWithMeta['author']): User {
  return {
    id: author.id,
    userId: '',
    password: '',
    name: author.name,
    email: '',
    nickname: author.nickname,
    bio: author.bio ?? '',
    location: author.location ?? '',
  }
}

function upsertUser(users: User[], nextUser: User) {
  const matchIndex = users.findIndex((user) => user.id === nextUser.id)

  if (matchIndex === -1) {
    return [...users, nextUser]
  }

  return users.map((user, index) => {
    if (index !== matchIndex) {
      return user
    }

    return {
      ...user,
      ...nextUser,
      password: user.password || nextUser.password,
      userId: user.userId || nextUser.userId,
      email: user.email || nextUser.email,
    }
  })
}

function toCommunityPost(post: PostWithMeta): Post {
  return {
    id: post.id,
    title: post.title,
    summary: post.summary,
    content: post.content,
    region: post.region,
    regionCode: post.regionCode,
    budget: post.budget,
    budgetCode: post.budgetCode,
    theme: post.theme,
    themeCode: post.themeCode,
    season: post.season,
    companion: post.companion,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    travelDate: post.travelDate,
    views: post.views,
    discussionCount: post.discussionCount,
    imageUrl: post.imageUrl,
    tags: post.tags,
    authorId: post.author.id,
  }
}

function upsertPosts(currentPosts: Post[], nextPosts: Post[]) {
  const postMap = new Map<number, Post>(currentPosts.map((post) => [post.id, post]))

  for (const nextPost of nextPosts) {
    const currentPost = postMap.get(nextPost.id)

    postMap.set(
      nextPost.id,
      currentPost
        ? {
            ...currentPost,
            ...nextPost,
          }
        : nextPost,
    )
  }

  return Array.from(postMap.values()).sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

function App() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<User[]>(INITIAL_USERS)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS)
  const [likedByUser, setLikedByUser] = useState<Record<number, number[]>>(INITIAL_LIKED_BY_USER)
  const [followedByUser, setFollowedByUser] = useState<Record<number, number[]>>(INITIAL_FOLLOWED_BY_USER)
  const [boardRefreshToken, setBoardRefreshToken] = useState(0)

  useEffect(() => {
    const token = getAuthToken()

    if (!token) {
      setIsAuthReady(true)
      return
    }

    let isMounted = true

    const restoreSession = async () => {
      try {
        const response = await fetchMe()
        const nextUser = mapAuthUserToCommunityUser(response.user)

        if (!isMounted) {
          return
        }

        setUsers((current) => upsertUser(current, nextUser))
        setCurrentUserId(nextUser.id)
      } catch {
        clearAuthToken()

        if (isMounted) {
          setCurrentUserId(null)
        }
      } finally {
        if (isMounted) {
          setIsAuthReady(true)
        }
      }
    }

    void restoreSession()

    return () => {
      isMounted = false
    }
  }, [])

  const currentUser = users.find((user) => user.id === currentUserId) ?? null
  const likedPostIds = new Set(currentUser ? likedByUser[currentUser.id] ?? [] : [])
  const followedAuthorIds = new Set(currentUser ? followedByUser[currentUser.id] ?? [] : [])

  const postsWithMeta = posts.flatMap((post) => {
    const author = users.find((user) => user.id === post.authorId)

    if (!author) {
      return []
    }

    return [
      {
        ...post,
        discussionCount: post.discussionCount ?? 0,
        author,
      },
    ]
  })

  const syncSocialState = useCallback(async (userId: number) => {
    try {
      const [bookmarksResponse, followsResponse] = await Promise.all([
        fetchMyBookmarks({ page: 1, limit: 100 }),
        fetchMyFollows({ page: 1, limit: 100 }),
      ])

      setLikedByUser((current) => ({
        ...current,
        [userId]: bookmarksResponse.items.map((post) => post.id),
      }))

      setFollowedByUser((current) => ({
        ...current,
        [userId]: followsResponse.items.map((user) => user.id),
      }))

      setUsers((current) =>
        followsResponse.items.reduce(
          (nextUsers, user) => upsertUser(nextUsers, mapAuthUserToCommunityUser(user)),
          current,
        ),
      )
    } catch {
      setLikedByUser((current) => ({
        ...current,
        [userId]: current[userId] ?? [],
      }))
      setFollowedByUser((current) => ({
        ...current,
        [userId]: current[userId] ?? [],
      }))
    }
  }, [])

  useEffect(() => {
    if (!currentUserId || !getAuthToken()) {
      return
    }

    void syncSocialState(currentUserId)
  }, [currentUserId, syncSocialState])

  const handleLogin = async (userId: string, password: string) => {
    try {
      const response = await loginUser({
        loginId: userId,
        password,
      })
      const nextUser = mapAuthUserToCommunityUser(response.user)

      setUsers((current) => upsertUser(current, nextUser))
      setCurrentUserId(nextUser.id)
      navigate('/main')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '아이디/비밀번호를 확인해주세요.')
    }
  }

  const handleSignup = async (payload: SignupPayload) => {
    try {
      await signupUser({
        name: payload.name,
        loginId: payload.userId,
        password: payload.password,
        passwordConfirm: payload.passwordConfirm,
        email: payload.email,
        nickname: payload.nickname,
      })

      return true
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '회원가입에 실패했습니다.')
      return false
    }
  }

  const handleSignOut = async () => {
    try {
      await logoutUser()
    } catch {
      clearAuthToken()
    }

    setCurrentUserId(null)
    setLikedByUser(INITIAL_LIKED_BY_USER)
    setFollowedByUser(INITIAL_FOLLOWED_BY_USER)
    navigate('/login')
  }

  const hydratePosts = useCallback((incomingPosts: PostWithMeta[]) => {
    if (!incomingPosts.length) {
      return
    }

    setUsers((current) =>
      incomingPosts.reduce(
        (nextUsers, post) => upsertUser(nextUsers, mapPostAuthorToCommunityUser(post.author)),
        current,
      ),
    )

    setPosts((current) => upsertPosts(current, incomingPosts.map(toCommunityPost)))
  }, [])

  const removePost = useCallback((postId: number) => {
    setPosts((current) => current.filter((post) => post.id !== postId))
  }, [])

  const refreshBoard = useCallback(() => {
    setBoardRefreshToken((current) => current + 1)
  }, [])

  const toggleLike = async (postId: number) => {
    if (!currentUser) {
      return
    }

    const alreadyLiked = likedPostIds.has(postId)

    try {
      if (alreadyLiked) {
        await removeBookmark(postId)
      } else {
        await addBookmark(postId)
      }

      setLikedByUser((current) => {
        const currentLikes = current[currentUser.id] ?? []
        const nextLikes = alreadyLiked
          ? currentLikes.filter((id) => id !== postId)
          : [...currentLikes, postId]

        return {
          ...current,
          [currentUser.id]: nextLikes,
        }
      })
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to update bookmark.')
    }
  }

  const toggleFollow = async (authorId: number) => {
    if (!currentUser) {
      return
    }

    const alreadyFollowing = followedAuthorIds.has(authorId)

    try {
      if (alreadyFollowing) {
        await unfollowUser(authorId)
      } else {
        await followUser(authorId)
      }

      setFollowedByUser((current) => {
        const currentFollows = current[currentUser.id] ?? []
        const nextFollows = alreadyFollowing
          ? currentFollows.filter((id) => id !== authorId)
          : [...currentFollows, authorId]

        return {
          ...current,
          [currentUser.id]: nextFollows,
        }
      })
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to update follow status.')
    }
  }

  const createPost = async (payload: {
    title: string
    travelDate: string
    imageUrl: string
    regionCode: string
    budgetCode: string
    themeCode: string
    season: string
    companion: string
    content: string
  }) => {
    if (!currentUser) {
      return false
    }

    try {
      const response = await createPostApi({
        title: payload.title,
        travelDate: payload.travelDate,
        imageUrl: payload.imageUrl,
        regionCode: payload.regionCode,
        budgetCode: payload.budgetCode,
        themeCode: payload.themeCode,
        season: payload.season,
        companion: payload.companion,
        content: payload.content,
      })

      hydratePosts([response.post])
      refreshBoard()
      return true
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '게시글 등록에 실패했습니다.')
      return false
    }
  }

  const updatePost = async (
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
  ) => {
    if (!currentUser) {
      return false
    }

    try {
      const response = await updatePostApi(postId, {
        title: payload.title,
        travelDate: payload.travelDate,
        imageUrl: payload.imageUrl,
        regionCode: payload.regionCode,
        budgetCode: payload.budgetCode,
        themeCode: payload.themeCode,
        season: payload.season,
        companion: payload.companion,
        content: payload.content,
      })

      hydratePosts([response.post])
      refreshBoard()
      return true
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to update post.')
      return false
    }
  }

  const deletePost = async (postId: number) => {
    if (!currentUser) {
      return false
    }

    try {
      await deletePostApi(postId)
      removePost(postId)
      refreshBoard()
      return true
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to delete post.')
      return false
    }
  }

  const incrementView = useCallback((postId: number) => {
    setPosts((current) =>
      current.map((post) => (post.id === postId ? { ...post, views: post.views + 1 } : post)),
    )
    void incrementPostView(postId).catch(() => undefined)
  }, [])

  const updateProfile = async (payload: {
    nickname: string
    password: string
    bio: string
    location: string
  }) => {
    if (!currentUser) {
      return false
    }

    try {
      const response = await updateMyProfileApi({
        nickname: payload.nickname,
        password: payload.password || undefined,
        bio: payload.bio,
        location: payload.location,
      })
      const nextUser = mapAuthUserToCommunityUser(response.user)

      setUsers((current) =>
        current.map((user) =>
          user.id === currentUser.id
            ? {
                ...user,
                ...nextUser,
                password: payload.password ? payload.password : user.password,
              }
            : user,
        ),
      )

      return true
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to update profile.')
      return false
    }
  }

  if (!isAuthReady) {
    return <div className="app-shell" />
  }

  return (
    <div className="app-shell">
      <AppShell currentUser={currentUser} onSignOut={handleSignOut} />
      <Routes>
        <Route path="/" element={<Navigate replace to={currentUser ? '/main' : '/login'} />} />
        <Route
          path="/login"
          element={currentUser ? <Navigate replace to="/main" /> : <LoginPage onLogin={handleLogin} />}
        />
        <Route
          path="/signup"
          element={
            currentUser ? (
              <Navigate replace to="/main" />
            ) : (
              <SignupPage
                onRequestEmailVerification={requestEmailVerification}
                onCheckLoginId={isLoginIdAvailable}
                onCheckNickname={isNicknameAvailable}
                onSignup={handleSignup}
              />
            )
          }
        />
        <Route
          path="/main"
          element={
            currentUser ? (
              <BoardPage
                currentUser={currentUser}
                likedPostIds={likedPostIds}
                onHydratePosts={hydratePosts}
                refreshToken={boardRefreshToken}
                onToggleLike={toggleLike}
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
                currentUser={currentUser}
                followedAuthorIds={followedAuthorIds}
                likedPostIds={likedPostIds}
                onUpdatePost={updatePost}
                onDeletePost={deletePost}
                onHydratePosts={hydratePosts}
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
          path="/posts/:postId/edit"
          element={
            currentUser ? (
              <WritePage onCreatePost={createPost} onUpdatePost={updatePost} />
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
                onHydratePosts={hydratePosts}
                onToggleFollow={toggleFollow}
                onToggleLike={toggleLike}
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
                currentUser={currentUser}
                onUpdateProfile={updateProfile}
              />
            ) : (
              <Navigate replace to="/login" />
            )
          }
        />
        <Route
          path="/write"
          element={
            currentUser ? (
              <WritePage onCreatePost={createPost} onUpdatePost={updatePost} />
            ) : (
              <Navigate replace to="/login" />
            )
          }
        />
        <Route
          path="/chat"
          element={currentUser ? <ChatPage posts={postsWithMeta} /> : <Navigate replace to="/login" />}
        />
        <Route
          path="/planner"
          element={
            currentUser ? (
              <PlannerPage currentUser={currentUser} posts={postsWithMeta} />
            ) : (
              <Navigate replace to="/login" />
            )
          }
        />
      </Routes>
    </div>
  )
}

export default App
