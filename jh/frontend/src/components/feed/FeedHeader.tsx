type FeedHeaderProps = {
  count: number
  copy: {
    description: string
    prompt: string
    trustHint: string
  }
  sort: 'latest' | 'popular' | 'views'
  title: string
  getSortHref: (sort: 'latest' | 'popular' | 'views') => string
}

const sortOptions = [
  { label: '최신', value: 'latest' },
  { label: '인기', value: 'popular' },
  { label: '조회수', value: 'views' },
] as const

export function FeedHeader({ copy, count, sort, title, getSortHref }: FeedHeaderProps) {
  return (
    <section className="feed-heading" aria-labelledby="feed-title">
      <div>
        <p className="feed-kicker">동물 일상 사진 게시판</p>
        <h1 id="feed-title">{title}</h1>
        <p className="feed-description">{copy.description}</p>
        <div className="feed-guide-row" aria-label="커뮤니티 안내">
          <span>{copy.prompt}</span>
          <span>{copy.trustHint}</span>
        </div>
      </div>
      <div className="feed-heading-side">
        <span className="feed-count">게시글 {count}개</span>
        <nav className="feed-sort" aria-label="피드 정렬">
          {sortOptions.map((option) =>
            option.value === sort ? (
              <span className="feed-sort-link is-active" aria-current="page" key={option.value}>
                {option.label}
              </span>
            ) : (
              <a className="feed-sort-link" href={getSortHref(option.value)} key={option.value}>
                {option.label}
              </a>
            ),
          )}
        </nav>
      </div>
    </section>
  )
}
