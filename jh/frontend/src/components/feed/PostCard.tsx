import type { Post } from '../../types/post'
import { categories } from '../../data/categories'
import { getCurrentPathWithSearch } from '../../utils/navigation'
import { getPostDetailPath } from '../../utils/paths'
import { SafeImage } from '../common/SafeImage'

type PostCardProps = {
  post: Post
  priority?: boolean
  variant?: 'standard' | 'featured'
}

export function PostCard({ post, priority = false, variant = 'standard' }: PostCardProps) {
  const categoryLabel =
    post.categoryInfo?.label ?? categories.find((category) => category.value === post.category)?.label ?? '일상'
  const imageLoading = priority ? 'eager' : 'lazy'

  return (
    <article
      className={
        variant === 'featured'
          ? 'post-card-link post-card-link--featured post-card post-card--featured'
          : 'post-card-link post-card'
      }
    >
      <a className="post-card-main-link" href={getPostDetailPath(post.id, getCurrentPathWithSearch())}>
        <div className="post-image-frame">
          <SafeImage
            className="post-image"
            src={post.cardImageUrl}
            alt={post.imageAlt}
            fallbackAlt="Tail Talk 기본 게시글 이미지"
            loading={imageLoading}
            decoding="async"
            sizes={
              variant === 'featured'
                ? '(min-width: 1024px) 50vw, 100vw'
                : '(min-width: 1100px) 33vw, (min-width: 720px) 50vw, 100vw'
            }
            srcSet={post.imageSrcSet || undefined}
          />
          <span className="post-category-pill">{categoryLabel}</span>
        </div>
        <div className="post-content">
          <h2>{post.title}</h2>
          <p>{post.body}</p>
        </div>
      </a>
    </article>
  )
}
