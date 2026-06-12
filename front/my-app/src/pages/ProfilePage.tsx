import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { PostCard } from '../components/PostCard'
import type { PostWithMeta, User } from '../types/community'
import { fetchUserPosts, fetchUserProfile } from '../utils/usersApi'
import '../styles/pages/ProfilePage.css'

type ProfilePageProps = {
  likedPostIds: Set<number>
  followedAuthorIds: Set<number>
  onToggleLike: (postId: number) => void
  onToggleFollow: (authorId: number) => void
  onHydratePosts: (posts: PostWithMeta[]) => void
}

function toCommunityUser(user: {
  id: number
  loginId: string
  name: string
  email: string
  nickname: string
  bio: string | null
  location: string | null
}): User {
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

export function ProfilePage({
  likedPostIds,
  followedAuthorIds,
  onToggleLike,
  onToggleFollow,
  onHydratePosts,
}: ProfilePageProps) {
  const params = useParams()
  const authorId = Number(params.authorId)
  const [author, setAuthor] = useState<User | null>(null)
  const [authorPosts, setAuthorPosts] = useState<PostWithMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!Number.isFinite(authorId)) {
      setErrorMessage('잘못된 프로필 주소입니다.')
      setIsLoading(false)
      return
    }

    let isMounted = true

    const loadProfile = async () => {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const [profileResponse, postsResponse] = await Promise.all([
          fetchUserProfile(authorId),
          fetchUserPosts(authorId, { page: 1, limit: 15 }),
        ])

        if (!isMounted) {
          return
        }

        const nextAuthor = toCommunityUser(profileResponse.user)
        setAuthor(nextAuthor)
        setAuthorPosts(postsResponse.items)
        onHydratePosts(postsResponse.items)
      } catch (error) {
        if (!isMounted) {
          return
        }

        setErrorMessage(error instanceof Error ? error.message : '프로필을 불러오지 못했습니다.')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadProfile()

    return () => {
      isMounted = false
    }
  }, [authorId, onHydratePosts])

  if (isLoading) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>프로필을 불러오는 중입니다...</h1>
        </section>
      </main>
    )
  }

  if (errorMessage || !author) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>{errorMessage || '프로필을 찾을 수 없습니다.'}</h1>
          <Link className="secondary-button" to="/main">
            메인으로 돌아가기
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="page profile-page">
      <section className="profile-hero">
        <span className="profile-hero__eyebrow">작성자 프로필</span>
        <h1>{author.nickname}</h1>
        <p>{author.bio || '아직 소개글이 없습니다.'}</p>
        <div className="profile-hero__meta">
          <span>{author.name}</span>
          <span>{author.location || '지역 정보 없음'}</span>
          <span>게시글 {authorPosts.length}개</span>
        </div>
        <button className="primary-button" type="button" onClick={() => onToggleFollow(author.id)}>
          {followedAuthorIds.has(author.id) ? '팔로우 취소' : '팔로우'}
        </button>
      </section>

      <section className="post-grid">
        {authorPosts.map((post) => (
          <PostCard
            chatHref={`/chat?${new URLSearchParams({
              q: `${post.region} ${post.theme} 여행 추천`,
              region: post.region,
              budget: post.budget,
              theme: post.theme,
              season: post.season,
              companion: post.companion,
              travelDate: post.travelDate,
            }).toString()}`}
            isLiked={likedPostIds.has(post.id)}
            key={post.id}
            onToggleLike={onToggleLike}
            plannerHref={`/planner?${new URLSearchParams({
              q: `${post.region} 여행 일정`,
              region: post.region,
              budget: post.budget,
              theme: post.theme,
              season: post.season,
              companion: post.companion,
              travelDate: post.travelDate,
              duration: '3',
            }).toString()}`}
            post={post}
          />
        ))}
      </section>
    </main>
  )
}
