import { Link } from 'react-router'
import type { PostWithMeta } from '../types/community'
import { formatCalendarDate, formatDate, getPostImageUrl } from '../utils/community'
import { localizeLookupValue } from '../utils/i18n'
import type { Language } from '../utils/language'
import '../styles/components/PostCard.css'

type PostCardProps = {
  post: PostWithMeta
  isLiked: boolean
  onToggleLike: (postId: number) => void
  language: Language
}

const COPY = {
  ko: {
    detail: '자세히 보기',
    chat: 'AI 추천받기',
    planner: '일정 만들기',
    travelDate: '여행일',
    views: '조회',
    comments: '댓글',
    save: '저장',
    saved: '저장됨',
  },
  en: {
    detail: 'View details',
    chat: 'Ask AI',
    planner: 'Build plan',
    travelDate: 'Travel date',
    views: 'Views',
    comments: 'Comments',
    save: 'Save',
    saved: 'Saved',
  },
} satisfies Record<Language, Record<string, string>>

export function PostCard({
  post,
  isLiked,
  onToggleLike,
  language,
}: PostCardProps) {
  const copy = COPY[language]

  const factChips = [
    localizeLookupValue('region', post.region, language, post.regionCode),
    localizeLookupValue('theme', post.theme, language, post.themeCode),
    localizeLookupValue('companion', post.companion, language),
    localizeLookupValue('budget', post.budget, language, post.budgetCode),
  ]

  return (
    <article className="post-card">
      <Link className="post-card__image-link" to={`/posts/${post.id}`}>
        <img
          alt={post.title}
          className="post-card__image"
          src={getPostImageUrl(post.imageUrl)}
          onError={(event) => {
            event.currentTarget.onerror = null
            event.currentTarget.src = getPostImageUrl()
          }}
        />
        <span className="post-card__image-badge">{copy.detail}</span>
      </Link>

      <div className="post-card__body">
        <div className="post-card__meta">
          <span>{formatDate(post.createdAt, language)}</span>
          <span>
            {copy.travelDate} {formatCalendarDate(post.travelDate, language)}
          </span>
        </div>

        <h2 className="post-card__title">
          <Link to={`/posts/${post.id}`}>{post.title}</Link>
        </h2>

        <div className="post-card__facts">
          {factChips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>

        <p className="post-card__summary">{post.summary}</p>

        <div className="post-card__tags">
          {post.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>

        <div className="post-card__footer">
          <div className="post-card__footer-top">
            <Link className="post-card__author" to={`/profile/${post.author.id}`}>
              {post.author.nickname}
            </Link>
            <div className="post-card__stats">
              <span>
                {copy.views} {post.views}
              </span>
              <span>
                {copy.comments} {post.discussionCount}
              </span>
            </div>
          </div>

          <div className="post-card__actions">
            <button
              aria-label={isLiked ? copy.saved : copy.save}
              className={`like-button ${isLiked ? 'active' : ''}`}
              type="button"
              onClick={() => onToggleLike(post.id)}
            >
              <span aria-hidden="true" className="like-button__heart">
                {isLiked ? '♥' : '♡'}
              </span>
              <span>{isLiked ? copy.saved : copy.save}</span>
            </button>

          </div>
        </div>
      </div>
    </article>
  )
}
