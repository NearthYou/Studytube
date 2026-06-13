import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { PostCard } from '../components/PostCard'
import type { PostWithMeta, User } from '../types/community'
import { localizeLookupValue } from '../utils/i18n'
import type { Language } from '../utils/language'
import { fetchUserPosts, fetchUserProfile } from '../utils/usersApi'
import '../styles/pages/ProfilePage.css'

type ProfilePageProps = {
  likedPostIds: Set<number>
  followedAuthorIds: Set<number>
  onToggleLike: (postId: number) => void
  onToggleFollow: (authorId: number) => void
  onHydratePosts: (posts: PostWithMeta[]) => void
  language: Language
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

const COPY = {
  ko: {
    invalidProfile: '잘못된 프로필 주소입니다.',
    loadFailed: '프로필을 불러오지 못했습니다.',
    loading: '프로필을 불러오는 중입니다...',
    notFound: '프로필을 찾을 수 없습니다.',
    backToMain: '메인으로 돌아가기',
    eyebrow: '작성자 프로필',
    noBio: '아직 소개글이 없습니다.',
    noLocation: '지역 정보 없음',
    posts: '게시글',
    cancelFollow: '팔로우 취소',
    follow: '팔로우',
  },
  en: {
    invalidProfile: 'Invalid profile address.',
    loadFailed: 'Failed to load the profile.',
    loading: 'Loading profile...',
    notFound: 'Profile not found.',
    backToMain: 'Back to home',
    eyebrow: 'Author profile',
    noBio: 'No bio yet.',
    noLocation: 'No location',
    posts: 'posts',
    cancelFollow: 'Unfollow',
    follow: 'Follow',
  },
} satisfies Record<Language, Record<string, string>>

export function ProfilePage({
  likedPostIds,
  followedAuthorIds,
  onToggleLike,
  onToggleFollow,
  onHydratePosts,
  language,
}: ProfilePageProps) {
  const copy = COPY[language]
  const params = useParams()
  const authorId = Number(params.authorId)
  const [author, setAuthor] = useState<User | null>(null)
  const [authorPosts, setAuthorPosts] = useState<PostWithMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!Number.isFinite(authorId)) {
      setErrorMessage(copy.invalidProfile)
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

        setErrorMessage(error instanceof Error ? error.message : copy.loadFailed)
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
  }, [authorId, copy.invalidProfile, copy.loadFailed, onHydratePosts])

  if (isLoading) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>{copy.loading}</h1>
        </section>
      </main>
    )
  }

  if (errorMessage || !author) {
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

  return (
    <main className="page profile-page">
      <section className="profile-hero">
        <span className="profile-hero__eyebrow">{copy.eyebrow}</span>
        <h1>{author.nickname}</h1>
        <p>{author.bio || copy.noBio}</p>
        <div className="profile-hero__meta">
          <span>{author.name}</span>
          <span>{author.location || copy.noLocation}</span>
          <span>{authorPosts.length} {copy.posts}</span>
        </div>
        <button className="primary-button" type="button" onClick={() => onToggleFollow(author.id)}>
          {followedAuthorIds.has(author.id) ? copy.cancelFollow : copy.follow}
        </button>
      </section>

      <section className="post-grid">
        {authorPosts.map((post) => {
          const region = localizeLookupValue('region', post.region, language, post.regionCode)
          const theme = localizeLookupValue('theme', post.theme, language, post.themeCode)
          const companion = localizeLookupValue('companion', post.companion, language)
          const budget = localizeLookupValue('budget', post.budget, language, post.budgetCode)

          return (
            <PostCard
              chatHref={`/chat?${new URLSearchParams({
                q:
                  language === 'ko'
                    ? `${region} ${theme} 여행 추천`
                    : `Recommend a ${theme.toLowerCase()} trip in ${region} for ${companion.toLowerCase()}.`,
                region,
                budget,
                theme,
                season: localizeLookupValue('season', post.season, language),
                companion,
                travelDate: post.travelDate,
              }).toString()}`}
              isLiked={likedPostIds.has(post.id)}
              key={post.id}
              language={language}
              onToggleLike={onToggleLike}
              plannerHref={`/planner?${new URLSearchParams({
                q:
                  language === 'ko'
                    ? `${region} 여행 일정`
                    : `Plan a trip in ${region}.`,
                region,
                budget,
                theme,
                season: localizeLookupValue('season', post.season, language),
                companion,
                travelDate: post.travelDate,
                duration: '3',
              }).toString()}`}
              post={post}
            />
          )
        })}
      </section>
    </main>
  )
}
