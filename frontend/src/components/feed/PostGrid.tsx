import type { Post } from '../../types/post'
import { appPaths } from '../../utils/paths'
import { PostCard } from './PostCard'

type PostGridProps = {
  emptyPrompt: string
  emptyTitle: string
  posts: Post[]
}

export function PostGrid({ emptyPrompt, emptyTitle, posts }: PostGridProps) {
  if (posts.length === 0) {
    return (
      <section className="feed-empty-state" aria-labelledby="feed-empty-title">
        <p className="feed-kicker">아직 조용한 방</p>
        <h2 id="feed-empty-title">아직 {emptyTitle}이 없어요.</h2>
        <p>{emptyPrompt}</p>
        <a className="ui-button ui-button--primary" href={appPaths.postCreate}>
          첫 글 남기기
        </a>
      </section>
    )
  }

  return (
    <section className="post-grid" aria-label="동물 사진 게시글">
      {posts.map((post, index) => (
        <PostCard key={post.id} post={post} priority={index === 0} variant={index === 0 ? 'featured' : 'standard'} />
      ))}
    </section>
  )
}
