import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { FilterSelect } from '../components/FilterSelect'
import { PostCard } from '../components/PostCard'
import type { Filters, PostWithMeta, SortOption, User } from '../types/community'
import { PAGE_SIZE } from '../utils/community'
import { localizeLookupOptions, localizeLookupValue } from '../utils/i18n'
import type { Language } from '../utils/language'
import { fetchPostFilters, type PostFilterLookups } from '../utils/lookupsApi'
import { fetchPosts } from '../utils/postsApi'
import '../styles/pages/BoardPage.css'

type BoardPageProps = {
  currentUser: User
  likedPostIds: Set<number>
  onToggleLike: (postId: number) => void
  onHydratePosts: (posts: PostWithMeta[]) => void
  refreshToken: number
  language: Language
}

const EMPTY_FILTERS: Filters = {
  region: '',
  budget: '',
  theme: '',
  season: '',
  companion: '',
}

const EMPTY_LOOKUPS: PostFilterLookups = {
  regions: [],
  themes: [],
  budgetRanges: [],
  seasons: [],
  companions: [],
}

const COPY = {
  ko: {
    heroEyebrow: 'travel board',
    heroTitle: '실제 여행 후기에서 바로 찾는 여행 아이디어',
    heroBody:
      '목적지, 예산, 테마를 한 번에 좁히고 게시글에서 채팅과 플래너로 자연스럽게 이어지는 구조로 정리했습니다.',
    write: '여행 글 쓰기',
    myPage: '마이페이지',
    chat: 'AI 추천 시작',
    planner: '플래너 열기',
    totalPosts: '전체 게시글',
    savedPosts: '저장한 글',
    currentPageStat: '현재 페이지',
    welcomeTitle: '안녕하세요',
    welcomeFallback: '지금 마음에 드는 여행 스타일을 골라서 바로 탐색해 보세요.',
    quickLinks: '바로가기',
    guideTitle: '이렇게 보면 편합니다',
    guideBody:
      '검색어를 먼저 넣고, 결과가 많으면 지역과 예산을 좁힌 뒤 테마를 고르면 탐색 속도가 훨씬 빨라집니다.',
    searchEyebrow: 'search and filter',
    searchTitle: '원하는 여행 글을 빠르게 찾기',
    searchBody: '여행지, 작성자, 태그, 분위기를 기준으로 결과를 정리할 수 있습니다.',
    searchPlaceholder: '여행지, 제목, 태그, 작성자 이름으로 검색',
    advancedOpen: '필터 열기',
    advancedClose: '필터 닫기',
    reset: '전체 초기화',
    region: '지역',
    budget: '예산',
    theme: '테마',
    season: '계절',
    companion: '동행',
    all: '전체',
    latest: '최신순',
    popular: '인기순',
    comments: '댓글 많은 순',
    activeFilters: '적용된 조건',
    resultSummary: '현재 결과',
    showing: '보이는 글',
    loadingTitle: '게시글을 불러오는 중입니다.',
    loadingBody: '선택한 조건에 맞는 여행 글을 다시 확인하고 있습니다.',
    errorTitle: '게시글을 불러오지 못했습니다.',
    emptyTitle: '조건에 맞는 여행 글이 없습니다.',
    emptyBody: '검색어를 바꾸거나 필터를 줄여서 다시 찾아보세요.',
    previous: '이전',
    next: '다음',
    page: '페이지',
    lookupError: '필터 목록을 불러오지 못했습니다.',
    postError: '게시글을 불러오지 못했습니다.',
  },
  en: {
    heroEyebrow: 'travel board',
    heroTitle: 'Find trip ideas directly from real travel posts',
    heroBody:
      'Narrow by destination, budget, and theme, then move from community posts into AI chat or the planner without losing context.',
    write: 'Write a post',
    myPage: 'My Page',
    chat: 'Start AI chat',
    planner: 'Open planner',
    totalPosts: 'Total posts',
    savedPosts: 'Saved posts',
    currentPageStat: 'Current page',
    welcomeTitle: 'Welcome',
    welcomeFallback: 'Pick the kind of trip you want and start browsing right away.',
    quickLinks: 'Quick links',
    guideTitle: 'A faster way to browse',
    guideBody:
      'Start with a keyword, narrow by region and budget, then use theme to find a better match much faster.',
    searchEyebrow: 'search and filter',
    searchTitle: 'Find the right post faster',
    searchBody: 'Search by destination, author, tag, or travel mood.',
    searchPlaceholder: 'Search by destination, title, tag, or author',
    advancedOpen: 'Open filters',
    advancedClose: 'Close filters',
    reset: 'Reset all',
    region: 'Region',
    budget: 'Budget',
    theme: 'Theme',
    season: 'Season',
    companion: 'Companion',
    all: 'All',
    latest: 'Latest',
    popular: 'Popular',
    comments: 'Most discussed',
    activeFilters: 'Active filters',
    resultSummary: 'Results',
    showing: 'Visible posts',
    loadingTitle: 'Loading posts.',
    loadingBody: 'Refreshing travel posts for the current filters.',
    errorTitle: 'Failed to load posts.',
    emptyTitle: 'No matching posts found.',
    emptyBody: 'Try a different keyword or reset some filters.',
    previous: 'Previous',
    next: 'Next',
    page: 'Page',
    lookupError: 'Failed to load filter options.',
    postError: 'Failed to load posts.',
  },
} satisfies Record<Language, Record<string, string>>

function findOptionLabel(options: { value: string; label: string }[], value: string) {
  return options.find((item) => item.value === value)?.label ?? value
}

export function BoardPage({
  currentUser,
  likedPostIds,
  onToggleLike,
  onHydratePosts,
  refreshToken,
  language,
}: BoardPageProps) {
  const copy = COPY[language]
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sortOption, setSortOption] = useState<SortOption>('latest')
  const [page, setPage] = useState(1)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [lookupOptions, setLookupOptions] = useState<PostFilterLookups>(EMPTY_LOOKUPS)
  const [posts, setPosts] = useState<PostWithMeta[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  useEffect(() => {
    let isMounted = true

    const loadLookups = async () => {
      try {
        const data = await fetchPostFilters()
        if (isMounted) {
          setLookupOptions(data)
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : copy.lookupError)
        }
      }
    }

    void loadLookups()

    return () => {
      isMounted = false
    }
  }, [copy.lookupError])

  useEffect(() => {
    let isMounted = true

    const loadPosts = async () => {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const response = await fetchPosts({
          q: deferredQuery,
          regionCode: filters.region,
          budgetCode: filters.budget,
          themeCode: filters.theme,
          season: filters.season,
          companion: filters.companion,
          sort: sortOption,
          page: currentPage,
          limit: PAGE_SIZE,
        })

        if (!isMounted) {
          return
        }

        setPosts(response.items)
        setTotalCount(response.totalCount)
        onHydratePosts(response.items)
      } catch (error) {
        if (!isMounted) {
          return
        }

        setPosts([])
        setTotalCount(0)
        setErrorMessage(error instanceof Error ? error.message : copy.postError)
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadPosts()

    return () => {
      isMounted = false
    }
  }, [
    copy.postError,
    currentPage,
    deferredQuery,
    filters.budget,
    filters.companion,
    filters.region,
    filters.season,
    filters.theme,
    onHydratePosts,
    refreshToken,
    sortOption,
  ])

  const localizedLookups: PostFilterLookups = {
    regions: localizeLookupOptions('region', lookupOptions.regions, language),
    themes: localizeLookupOptions('theme', lookupOptions.themes, language),
    budgetRanges: localizeLookupOptions('budget', lookupOptions.budgetRanges, language),
    seasons: localizeLookupOptions('season', lookupOptions.seasons, language),
    companions: localizeLookupOptions('companion', lookupOptions.companions, language),
  }

  const activeFilterChips = useMemo(() => {
    const chips: string[] = []

    if (deferredQuery) {
      chips.push(`"${deferredQuery}"`)
    }
    if (filters.region) {
      chips.push(findOptionLabel(localizedLookups.regions, filters.region))
    }
    if (filters.budget) {
      chips.push(findOptionLabel(localizedLookups.budgetRanges, filters.budget))
    }
    if (filters.theme) {
      chips.push(findOptionLabel(localizedLookups.themes, filters.theme))
    }
    if (filters.season) {
      chips.push(findOptionLabel(localizedLookups.seasons, filters.season))
    }
    if (filters.companion) {
      chips.push(findOptionLabel(localizedLookups.companions, filters.companion))
    }

    return chips
  }, [
    deferredQuery,
    filters.budget,
    filters.companion,
    filters.region,
    filters.season,
    filters.theme,
    localizedLookups.budgetRanges,
    localizedLookups.companions,
    localizedLookups.regions,
    localizedLookups.seasons,
    localizedLookups.themes,
  ])

  const summaryStats = [
    { label: copy.totalPosts, value: `${totalCount}` },
    { label: copy.savedPosts, value: `${likedPostIds.size}` },
    { label: copy.currentPageStat, value: `${currentPage}` },
  ]

  const updateFilter = (key: keyof Filters, value: string) => {
    startTransition(() => {
      setFilters((current) => ({ ...current, [key]: value }))
      setPage(1)
    })
  }

  const updateSort = (nextSort: SortOption) => {
    startTransition(() => {
      setSortOption(nextSort)
      setPage(1)
    })
  }

  const buildChatHref = (post?: PostWithMeta) => {
    const params = new URLSearchParams()

    if (post) {
      const region = localizeLookupValue('region', post.region, language, post.regionCode)
      const theme = localizeLookupValue('theme', post.theme, language, post.themeCode)
      const companion = localizeLookupValue('companion', post.companion, language)

      params.set(
        'q',
        language === 'ko'
          ? `${region}에서 ${companion}과 함께할 ${theme} 여행을 추천해 줘.`
          : `Recommend a ${theme.toLowerCase()} trip in ${region} for ${companion.toLowerCase()}.`,
      )
      params.set('region', region)
      params.set('theme', theme)
      params.set('companion', companion)
      params.set('budget', localizeLookupValue('budget', post.budget, language, post.budgetCode))
      params.set('travelDate', post.travelDate)
    }

    return `/chat?${params.toString()}`
  }

  const buildPlannerHref = (post?: PostWithMeta) => {
    const params = new URLSearchParams()

    if (post) {
      const region = localizeLookupValue('region', post.region, language, post.regionCode)
      const theme = localizeLookupValue('theme', post.theme, language, post.themeCode)
      const companion = localizeLookupValue('companion', post.companion, language)

      params.set(
        'q',
        language === 'ko'
          ? `${region}에서 ${companion}과 가는 ${theme} 여행 일정을 짜 줘.`
          : `Plan a ${theme.toLowerCase()} trip in ${region} for ${companion.toLowerCase()}.`,
      )
      params.set('region', region)
      params.set('theme', theme)
      params.set('companion', companion)
      params.set('budget', localizeLookupValue('budget', post.budget, language, post.budgetCode))
      params.set('travelDate', post.travelDate)
      params.set('duration', '3')
    }

    return `/planner?${params.toString()}`
  }

  return (
    <main className="page board-page">
      <section className="board-hero">
        <div className="board-hero__copy">
          <span>{copy.heroEyebrow}</span>
          <h1>{copy.heroTitle}</h1>
          <p>{copy.heroBody}</p>
          <div className="board-hero__actions">
            <Link className="primary-button" to="/write">
              {copy.write}
            </Link>
            <Link className="secondary-button" to="/chat">
              {copy.chat}
            </Link>
            <Link className="secondary-button" to="/planner">
              {copy.planner}
            </Link>
          </div>
        </div>

        <div className="board-hero__stats">
          {summaryStats.map((item) => (
            <article className="board-stat-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>
      </section>

      <div className="board-layout">
        <aside className="board-sidebar">
          <section className="sidebar-panel">
            <span className="sidebar-panel__label">{copy.welcomeTitle}</span>
            <h2>{currentUser.nickname}</h2>
            <p>{currentUser.bio || copy.welcomeFallback}</p>
          </section>

          <section className="sidebar-panel">
            <span className="sidebar-panel__label">{copy.quickLinks}</span>
            <Link to="/mypage">{copy.myPage}</Link>
            <Link to="/write">{copy.write}</Link>
            <Link to="/chat">{copy.chat}</Link>
            <Link to="/planner">{copy.planner}</Link>
          </section>

          <section className="sidebar-panel">
            <span className="sidebar-panel__label">{copy.guideTitle}</span>
            <p>{copy.guideBody}</p>
          </section>
        </aside>

        <section className="board-content">
          <section className="search-panel">
            <div className="search-panel__top">
              <div>
                <span className="section-label">{copy.searchEyebrow}</span>
                <h2>{copy.searchTitle}</h2>
                <p>{copy.searchBody}</p>
              </div>

              <div className="sort-group">
                <button
                  className={sortOption === 'latest' ? 'active' : ''}
                  type="button"
                  onClick={() => updateSort('latest')}
                >
                  {copy.latest}
                </button>
                <button
                  className={sortOption === 'popular' ? 'active' : ''}
                  type="button"
                  onClick={() => updateSort('popular')}
                >
                  {copy.popular}
                </button>
                <button
                  className={sortOption === 'comments' ? 'active' : ''}
                  type="button"
                  onClick={() => updateSort('comments')}
                >
                  {copy.comments}
                </button>
              </div>
            </div>

            <div className="search-row">
              <input
                className="search-input"
                placeholder={copy.searchPlaceholder}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(1)
                }}
              />
              <button
                className={`toggle-button ${showAdvanced ? 'active' : ''}`}
                type="button"
                onClick={() => setShowAdvanced((current) => !current)}
              >
                {showAdvanced ? copy.advancedClose : copy.advancedOpen}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  startTransition(() => {
                    setFilters(EMPTY_FILTERS)
                    setQuery('')
                    setPage(1)
                  })
                }}
              >
                {copy.reset}
              </button>
            </div>

            {showAdvanced ? (
              <div className="filter-grid board-filter-grid">
                <FilterSelect
                  label={copy.region}
                  options={localizedLookups.regions}
                  placeholder={copy.all}
                  value={filters.region}
                  onChange={(value) => updateFilter('region', value)}
                />
                <FilterSelect
                  label={copy.budget}
                  options={localizedLookups.budgetRanges}
                  placeholder={copy.all}
                  value={filters.budget}
                  onChange={(value) => updateFilter('budget', value)}
                />
                <FilterSelect
                  label={copy.theme}
                  options={localizedLookups.themes}
                  placeholder={copy.all}
                  value={filters.theme}
                  onChange={(value) => updateFilter('theme', value)}
                />
                <FilterSelect
                  label={copy.season}
                  options={localizedLookups.seasons}
                  placeholder={copy.all}
                  value={filters.season}
                  onChange={(value) => updateFilter('season', value)}
                />
                <FilterSelect
                  label={copy.companion}
                  options={localizedLookups.companions}
                  placeholder={copy.all}
                  value={filters.companion}
                  onChange={(value) => updateFilter('companion', value)}
                />
              </div>
            ) : null}

            {activeFilterChips.length ? (
              <div className="active-filter-panel">
                <span>{copy.activeFilters}</span>
                <div className="active-filter-panel__chips">
                  {activeFilterChips.map((chip) => (
                    <strong key={chip}>{chip}</strong>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <div className="board-result-bar">
            <div>
              <strong>{copy.resultSummary}</strong>
              <p>
                {copy.showing} {posts.length} / {totalCount}
              </p>
            </div>
            <span>
              {copy.page} {currentPage} / {totalPages}
            </span>
          </div>

          <section className="post-grid">
            {isLoading ? (
              <section className="empty-state">
                <h2>{copy.loadingTitle}</h2>
                <p>{copy.loadingBody}</p>
              </section>
            ) : null}

            {!isLoading && errorMessage ? (
              <section className="empty-state">
                <h2>{copy.errorTitle}</h2>
                <p>{errorMessage}</p>
              </section>
            ) : null}

            {!isLoading && !errorMessage && !posts.length ? (
              <section className="empty-state">
                <h2>{copy.emptyTitle}</h2>
                <p>{copy.emptyBody}</p>
              </section>
            ) : null}

            {!isLoading && !errorMessage
              ? posts.map((post) => (
                  <PostCard
                    chatHref={buildChatHref(post)}
                    isLiked={likedPostIds.has(post.id)}
                    key={post.id}
                    language={language}
                    onToggleLike={onToggleLike}
                    plannerHref={buildPlannerHref(post)}
                    post={post}
                  />
                ))
              : null}
          </section>

          <section className="pagination">
            <button
              disabled={currentPage === 1}
              type="button"
              onClick={() => startTransition(() => setPage((current) => Math.max(1, current - 1)))}
            >
              {copy.previous}
            </button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => (
              <button
                className={number === currentPage ? 'active' : ''}
                key={number}
                type="button"
                onClick={() => startTransition(() => setPage(number))}
              >
                {number}
              </button>
            ))}
            <button
              disabled={currentPage === totalPages}
              type="button"
              onClick={() =>
                startTransition(() => setPage((current) => Math.min(totalPages, current + 1)))
              }
            >
              {copy.next}
            </button>
          </section>
        </section>
      </div>
    </main>
  )
}
