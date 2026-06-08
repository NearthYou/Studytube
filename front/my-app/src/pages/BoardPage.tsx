import { startTransition, useDeferredValue, useState } from 'react'
import { Link } from 'react-router'
import { BUDGETS, COMPANIONS, EMPTY_FILTERS, REGIONS, SEASONS, THEMES } from '../data/mockData'
import { FilterSelect } from '../components/FilterSelect'
import { PostCard } from '../components/PostCard'
import type { Filters, PostWithMeta, SortOption, User } from '../types/community'
import { PAGE_SIZE } from '../utils/community'
import '../styles/pages/BoardPage.css'

type BoardPageProps = {
  currentUser: User
  posts: PostWithMeta[]
  likedPostIds: Set<number>
  onToggleLike: (postId: number) => void
}

export function BoardPage({
  currentUser,
  posts,
  likedPostIds,
  onToggleLike,
}: BoardPageProps) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sortOption, setSortOption] = useState<SortOption>('latest')
  const [page, setPage] = useState(1)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const filteredPosts = posts
    .filter((post) => {
      const matchesQuery =
        !deferredQuery ||
        [post.title, post.summary, post.region, post.theme, post.author.nickname, ...post.tags]
          .join(' ')
          .toLowerCase()
          .includes(deferredQuery)

      const matchesRegion = !filters.region || post.region === filters.region
      const matchesBudget = !filters.budget || post.budget === filters.budget
      const matchesTheme = !filters.theme || post.theme === filters.theme
      const matchesSeason = !filters.season || post.season === filters.season
      const matchesCompanion = !filters.companion || post.companion === filters.companion

      return (
        matchesQuery &&
        matchesRegion &&
        matchesBudget &&
        matchesTheme &&
        matchesSeason &&
        matchesCompanion
      )
    })
    .sort((left, right) => {
      if (sortOption === 'popular') {
        return right.views - left.views
      }
      if (sortOption === 'comments') {
        return right.discussionCount - left.discussionCount
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })

  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedPosts = filteredPosts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

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

  return (
    <main className="page board-page">
      <header className="board-page__headline">
        <span>Travel Community Feed</span>
        <h1>THE TRAVEL JOURNAL</h1>
        <p>카드형 게시글, 블로그형 레이아웃, 정렬과 상세 검색이 한 화면에서 보이도록 구성했습니다.</p>
      </header>

      <div className="board-layout">
        <aside className="board-sidebar">
          <div className="sidebar-panel">
            <span className="sidebar-panel__label">WELCOME</span>
            <h2>{currentUser.nickname}</h2>
            <p>{currentUser.bio}</p>
          </div>
          <div className="sidebar-panel">
            <span className="sidebar-panel__label">MENU</span>
            <Link to="/mypage">마이페이지</Link>
            <Link to="/write">글쓰기</Link>
            <Link to="/chat">여행추천봇</Link>
          </div>
          <div className="sidebar-panel">
            <span className="sidebar-panel__label">QUICK INFO</span>
            <p>좋아요한 글과 내가 쓴 댓글은 마이페이지에서 모아볼 수 있습니다.</p>
          </div>
        </aside>

        <section className="board-content">
          <div className="board-toolbar">
            <div className="search-stack">
              <div className="search-row">
                <input
                  className="search-input"
                  placeholder="여행지, 작성자, 태그, 테마로 검색"
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
                    options={REGIONS}
                    value={filters.region}
                    onChange={(value) => updateFilter('region', value)}
                  />
                  <FilterSelect
                    label="예산"
                    options={BUDGETS}
                    value={filters.budget}
                    onChange={(value) => updateFilter('budget', value)}
                  />
                  <FilterSelect
                    label="테마"
                    options={THEMES}
                    value={filters.theme}
                    onChange={(value) => updateFilter('theme', value)}
                  />
                  <FilterSelect
                    label="계절"
                    options={SEASONS}
                    value={filters.season}
                    onChange={(value) => updateFilter('season', value)}
                  />
                  <FilterSelect
                    label="동행 여부"
                    options={COMPANIONS}
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
            <strong>{filteredPosts.length}개의 게시글</strong>
            <span>사진, 태그, 본문 요약 1~2줄을 카드로 확인할 수 있습니다.</span>
          </div>

          <section className="post-grid">
            {pagedPosts.map((post) => (
              <PostCard
                isLiked={likedPostIds.has(post.id)}
                key={post.id}
                onToggleLike={onToggleLike}
                post={post}
              />
            ))}
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

          <section className="about-panel">
            <div className="about-panel__image">
              <img
                alt="travel portrait"
                src="https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1200&q=80"
              />
            </div>
            <div className="about-panel__copy">
              <span>ABOUT TRIPBOARD</span>
              <h2>여행지를 추천하고 경험을 나누는 공간</h2>
              <p>
                메인에서는 게시글을 탐색하고, 상세 페이지에서 댓글과 프로필을 이어서 보고,
                마이페이지에서는 내가 쓴 글과 좋아요한 글, 댓글, 계정 정보를 모아볼 수
                있습니다.
              </p>
              <Link className="secondary-button" to="/chat">
                여행추천봇 보러가기
              </Link>
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}
