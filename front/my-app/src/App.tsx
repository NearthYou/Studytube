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
import { getInitialLanguage, type Language } from './utils/language'
import { fetchMyBookmarks, fetchMyFollows, updateMyProfile as updateMyProfileApi } from './utils/meApi'
import type { PublicApiUser } from './utils/usersApi'
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

const COPY = {
  ko: {
    loginFallback: '아이디와 비밀번호를 확인해주세요.',
    signupFallback: '회원가입에 실패했습니다.',
    likeFallback: '찜 상태를 변경하지 못했습니다.',
    followFallback: '팔로우 상태를 변경하지 못했습니다.',
    createPostFallback: '게시글 등록에 실패했습니다.',
    updatePostFallback: '게시글을 수정하지 못했습니다.',
    deletePostFallback: '게시글을 삭제하지 못했습니다.',
    profileFallback: '회원 정보를 수정하지 못했습니다.',
  },
  en: {
    loginFallback: 'Check your user ID and password.',
    signupFallback: 'Sign-up failed.',
    likeFallback: 'Failed to update the saved state.',
    followFallback: 'Failed to update the follow state.',
    createPostFallback: 'Failed to create the post.',
    updatePostFallback: 'Failed to update the post.',
    deletePostFallback: 'Failed to delete the post.',
    profileFallback: 'Failed to update the profile.',
  },
} satisfies Record<Language, Record<string, string>>

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

function mapPublicUserToCommunityUser(user: PublicApiUser): User {
  return {
    id: user.id,
    userId: user.loginId,
    password: '',
    name: user.name,
    email: '',
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
  const [isAuthReady, setIsAuthReady] = useState(() => !getAuthToken())
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS)
  const [likedByUser, setLikedByUser] = useState<Record<number, number[]>>(INITIAL_LIKED_BY_USER)
  const [followedByUser, setFollowedByUser] = useState<Record<number, number[]>>(INITIAL_FOLLOWED_BY_USER)
  const [boardRefreshToken, setBoardRefreshToken] = useState(0)
  const [language, setLanguage] = useState<Language>(getInitialLanguage)
  const copy = COPY[language]

  useEffect(() => {
    window.localStorage.setItem('tripy-language', language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    const token = getAuthToken()

    if (!token) {
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

  useEffect(() => {
    if (!currentUserId || !getAuthToken()) {
      return
    }

    let isMounted = true

    const loadSocialState = async () => {
      try {
        const [bookmarksResponse, followsResponse] = await Promise.all([
          fetchMyBookmarks({ page: 1, limit: 100 }),
          fetchMyFollows({ page: 1, limit: 100 }),
        ])

        if (!isMounted) {
          return
        }

        setLikedByUser((current) => ({
          ...current,
          [currentUserId]: bookmarksResponse.items.map((post) => post.id),
        }))

        setFollowedByUser((current) => ({
          ...current,
          [currentUserId]: followsResponse.items.map((user) => user.id),
        }))

        setUsers((current) =>
          followsResponse.items.reduce(
            (nextUsers, user) => upsertUser(nextUsers, mapPublicUserToCommunityUser(user)),
            current,
          ),
        )
      } catch {
        if (!isMounted) {
          return
        }

        setLikedByUser((current) => ({
          ...current,
          [currentUserId]: current[currentUserId] ?? [],
        }))
        setFollowedByUser((current) => ({
          ...current,
          [currentUserId]: current[currentUserId] ?? [],
        }))
      }
    }

    void loadSocialState()

    return () => {
      isMounted = false
    }
  }, [currentUserId])

  const toggleLanguage = () => {
    setLanguage((current) => (current === 'ko' ? 'en' : 'ko'))
  }

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
      window.alert(error instanceof Error ? error.message : copy.loginFallback)
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
      window.alert(error instanceof Error ? error.message : copy.signupFallback)
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
      window.alert(error instanceof Error ? error.message : copy.likeFallback)
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
      window.alert(error instanceof Error ? error.message : copy.followFallback)
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
      window.alert(error instanceof Error ? error.message : copy.createPostFallback)
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
      window.alert(error instanceof Error ? error.message : copy.updatePostFallback)
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
      window.alert(error instanceof Error ? error.message : copy.deletePostFallback)
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
      window.alert(error instanceof Error ? error.message : copy.profileFallback)
      return false
    }
  }

  if (!isAuthReady) {
    return <div className="app-shell" />
  }

  return (
    <div className="app-shell">
      <AppShell currentUser={currentUser} language={language} onSignOut={handleSignOut} onToggleLanguage={toggleLanguage} />
      <Routes>
        <Route path="/" element={<Navigate replace to={currentUser ? '/main' : '/login'} />} />
        <Route
          path="/login"
          element={
            currentUser ? (
              <Navigate replace to="/main" />
            ) : (
              <LoginPage language={language} onLogin={handleLogin} onToggleLanguage={toggleLanguage} />
            )
          }
        />
        <Route
          path="/signup"
          element={
            currentUser ? (
              <Navigate replace to="/main" />
            ) : (
              <SignupPage
                language={language}
                onCheckLoginId={isLoginIdAvailable}
                onCheckNickname={isNicknameAvailable}
                onRequestEmailVerification={requestEmailVerification}
                onSignup={handleSignup}
                onToggleLanguage={toggleLanguage}
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
                language={language}
                likedPostIds={likedPostIds}
                onHydratePosts={hydratePosts}
                onToggleLike={toggleLike}
                refreshToken={boardRefreshToken}
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
                language={language}
                likedPostIds={likedPostIds}
                onDeletePost={deletePost}
                onHydratePosts={hydratePosts}
                onIncrementView={incrementView}
                onToggleFollow={toggleFollow}
                onToggleLike={toggleLike}
                onUpdatePost={updatePost}
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
              <WritePage language={language} onCreatePost={createPost} onUpdatePost={updatePost} />
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
                language={language}
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
              <MyPage currentUser={currentUser} language={language} onUpdateProfile={updateProfile} />
            ) : (
              <Navigate replace to="/login" />
            )
          }
        />
        <Route
          path="/write"
          element={
            currentUser ? (
              <WritePage language={language} onCreatePost={createPost} onUpdatePost={updatePost} />
            ) : (
              <Navigate replace to="/login" />
            )
          }
        />
        <Route
          path="/chat"
          element={
            currentUser ? <ChatPage language={language} posts={postsWithMeta} /> : <Navigate replace to="/login" />
          }
        />
        <Route
          path="/planner"
          element={
            currentUser ? (
              <PlannerPage currentUser={currentUser} language={language} posts={postsWithMeta} />
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
