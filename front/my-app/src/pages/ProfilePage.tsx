import { Link, useParams } from 'react-router'
import { PostCard } from '../components/PostCard'
import type { PostWithMeta, User } from '../types/community'
import '../styles/pages/ProfilePage.css'

type ProfilePageProps = {
  users: User[]
  posts: PostWithMeta[]
  likedPostIds: Set<number>
  followedAuthorIds: Set<number>
  onToggleLike: (postId: number) => void
  onToggleFollow: (authorId: number) => void
}

export function ProfilePage({
  users,
  posts,
  likedPostIds,
  followedAuthorIds,
  onToggleLike,
  onToggleFollow,
}: ProfilePageProps) {
  const params = useParams()
  const authorId = Number(params.authorId)
  const author = users.find((item) => item.id === authorId)

  if (!author) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>프로필을 찾을 수 없습니다.</h1>
          <Link className="secondary-button" to="/main">
            메인으로 돌아가기
          </Link>
        </section>
      </main>
    )
  }

  const authorPosts = posts.filter((post) => post.author.id === author.id)

  return (
    <main className="page profile-page">
      <section className="profile-hero">
        <span className="profile-hero__eyebrow">WRITER PROFILE</span>
        <h1>{author.nickname}</h1>
        <p>{author.bio}</p>
        <div className="profile-hero__meta">
          <span>{author.name}</span>
          <span>{author.location}</span>
          <span>게시글 {authorPosts.length}</span>
        </div>
        <button className="primary-button" type="button" onClick={() => onToggleFollow(author.id)}>
          {followedAuthorIds.has(author.id) ? '팔로우 취소' : '팔로우'}
        </button>
      </section>

      <section className="post-grid">
        {authorPosts.map((post) => (
          <PostCard
            chatHref={`/chat?${new URLSearchParams({
              q: `${post.region} ${post.theme} 추천`,
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
              q: `${post.region} 일정 짜줘`,
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
