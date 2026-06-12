import { startTransition, useDeferredValue, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { FilterSelect } from '../components/FilterSelect'
import { PostCard } from '../components/PostCard'
import type { Filters, PostWithMeta, SortOption, User } from '../types/community'
import { PAGE_SIZE } from '../utils/community'
import { fetchPostFilters, type PostFilterLookups } from '../utils/lookupsApi'
import { fetchPosts } from '../utils/postsApi'
import '../styles/pages/BoardPage.css'

type BoardPageProps = {
  currentUser: User
  likedPostIds: Set<number>
  onToggleLike: (postId: number) => void
  onHydratePosts: (posts: PostWithMeta[]) => void
  refreshToken: number
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

export function BoardPage({
  currentUser,
  likedPostIds,
  onToggleLike,
  onHydratePosts,
  refreshToken,
}: BoardPageProps) {
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
          setErrorMessage(error instanceof Error ? error.message : '필터 옵션을 불러오지 못했습니다.')
        }
      }
    }

    void loadLookups()

    return () => {
      isMounted = false
    }
  }, [])

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
        setErrorMessage(error instanceof Error ? error.message : '게시글을 불러오지 못했습니다.')
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
      params.set('q', `${post.region} ${post.theme} ${post.companion} 여행 추천`)
      params.set('region', post.region)
      params.set('theme', post.theme)
      params.set('companion', post.companion)
      params.set('budget', post.budget)
      params.set('travelDate', post.travelDate)
    }

    return `/chat?${params.toString()}`
  }

  const buildPlannerHref = (post?: PostWithMeta) => {
    const params = new URLSearchParams()

    if (post) {
      params.set('q', `${post.region} ${post.theme} 일정 추천`)
      params.set('region', post.region)
      params.set('theme', post.theme)
      params.set('companion', post.companion)
      params.set('budget', post.budget)
      params.set('travelDate', post.travelDate)
      params.set('duration', '3')
    }

    return `/planner?${params.toString()}`
  }

  return (
    <main className="page board-page">
      <header className="board-page__headline">
        <span>여행 커뮤니티 피드</span>
        <h1>여행 기록 게시판</h1>
        <p>검색어와 상세 필터를 조합해서 실제 DB에 저장된 여행 게시글을 찾아볼 수 있습니다.</p>
      </header>

      <div className="board-layout">
        <aside className="board-sidebar">
          <div className="sidebar-panel">
            <span className="sidebar-panel__label">환영합니다</span>
            <h2>{currentUser.nickname}</h2>
            <p>{currentUser.bio || '여행 기록을 하나씩 쌓아가는 중입니다.'}</p>
          </div>
          <div className="sidebar-panel">
            <span className="sidebar-panel__label">바로가기</span>
            <Link to="/mypage">마이페이지</Link>
            <Link to="/write">글쓰기</Link>
            <Link to="/chat">여행 추천 챗봇</Link>
            <Link to="/planner">플래너</Link>
          </div>
          <div className="sidebar-panel">
            <span className="sidebar-panel__label">안내</span>
            <p>검색창과 필터를 함께 쓰면 원하는 조건의 여행 글을 더 빠르게 찾을 수 있습니다.</p>
          </div>
        </aside>

        <section className="board-content">
          <section className="ai-launchpad">
            <div className="ai-launchpad__copy">
              <span>AI 여행 도우미</span>
              <h2>게시글 검색과 추천 흐름이 자연스럽게 이어지는 메인 화면</h2>
              <p>
                검색어는 고정값이 아니라 사용자가 입력한 문장 그대로 반영됩니다. 원하는 지역, 예산, 테마를
                먼저 둘러본 뒤 추천 챗봇이나 플래너로 이어서 사용할 수 있습니다.
              </p>
            </div>
            <div className="ai-launchpad__actions">
              <Link className="primary-button" to={buildChatHref()}>
                추천 챗봇 시작
              </Link>
              <Link className="secondary-button" to={buildPlannerHref()}>
                플래너 열기
              </Link>
            </div>
          </section>

          <div className="board-toolbar">
            <div className="search-stack">
              <div className="search-row">
                <input
                  className="search-input"
                  placeholder="여행지, 제목, 태그, 작성자 이름으로 검색"
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
                  상세 필터 {showAdvanced ? '닫기' : '열기'}
                </button>
              </div>
              {showAdvanced ? (
                <div className="filter-grid board-filter-grid">
                  <FilterSelect
                    label="지역"
                    options={lookupOptions.regions}
                    value={filters.region}
                    onChange={(value) => updateFilter('region', value)}
                  />
                  <FilterSelect
                    label="예산"
                    options={lookupOptions.budgetRanges}
                    value={filters.budget}
                    onChange={(value) => updateFilter('budget', value)}
                  />
                  <FilterSelect
                    label="테마"
                    options={lookupOptions.themes}
                    value={filters.theme}
                    onChange={(value) => updateFilter('theme', value)}
                  />
                  <FilterSelect
                    label="계절"
                    options={lookupOptions.seasons}
                    value={filters.season}
                    onChange={(value) => updateFilter('season', value)}
                  />
                  <FilterSelect
                    label="동행"
                    options={lookupOptions.companions}
                    value={filters.companion}
                    onChange={(value) => updateFilter('companion', value)}
                  />
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
                    초기화
                  </button>
                </div>
              ) : null}
            </div>

            <div className="sort-group">
              <button
                className={sortOption === 'latest' ? 'active' : ''}
                type="button"
                onClick={() => updateSort('latest')}
              >
                최신순
              </button>
              <button
                className={sortOption === 'popular' ? 'active' : ''}
                type="button"
                onClick={() => updateSort('popular')}
              >
                인기순
              </button>
              <button
                className={sortOption === 'comments' ? 'active' : ''}
                type="button"
                onClick={() => updateSort('comments')}
              >
                댓글 많은 순
              </button>
            </div>
          </div>

          <div className="board-result-bar">
            <strong>총 {totalCount}개의 게시글</strong>
            <span>
              {query.trim() ? `"${query.trim()}" 검색 결과` : '전체 게시글'} · {currentPage} / {totalPages} 페이지
            </span>
          </div>

          <section className="post-grid">
            {isLoading ? (
              <section className="empty-state">
                <h2>게시글을 불러오는 중입니다.</h2>
                <p>검색 조건에 맞는 결과를 다시 조회하고 있습니다.</p>
              </section>
            ) : null}

            {!isLoading && errorMessage ? (
              <section className="empty-state">
                <h2>게시글을 불러오지 못했습니다.</h2>
                <p>{errorMessage}</p>
              </section>
            ) : null}

            {!isLoading && !errorMessage && !posts.length ? (
              <section className="empty-state">
                <h2>검색 결과가 없습니다.</h2>
                <p>검색어를 바꾸거나 상세 필터를 초기화해서 다시 확인해보세요.</p>
              </section>
            ) : null}

            {!isLoading && !errorMessage
              ? posts.map((post) => (
                  <PostCard
                    chatHref={buildChatHref(post)}
                    isLiked={likedPostIds.has(post.id)}
                    key={post.id}
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
              이전
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
              다음
            </button>
          </section>

        </section>
      </div>
    </main>
  )
}
