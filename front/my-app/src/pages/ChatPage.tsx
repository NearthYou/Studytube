import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { PostWithMeta } from '../types/community'
import {
  buildAgentPlan,
  buildWeatherInsight,
  inferSeasonFromDate,
  retrieveRelevantPosts,
  type AssistantRequest,
} from '../utils/travelAssistant'
import '../styles/pages/ChatPage.css'

type ChatPageProps = {
  posts: PostWithMeta[]
}

type Message = {
  role: 'assistant' | 'user'
  text: string
}

function getInitialRequest(searchParams: URLSearchParams): AssistantRequest {
  const travelDate = searchParams.get('travelDate') ?? '2026-07-12'

  return {
    query: searchParams.get('q') ?? '여름에 친구랑 10~20만원대로 갈 만한 바다 여행지 추천해줘',
    region: searchParams.get('region') ?? '',
    budget: searchParams.get('budget') ?? '',
    theme: searchParams.get('theme') ?? '',
    season: searchParams.get('season') ?? inferSeasonFromDate(travelDate),
    companion: searchParams.get('companion') ?? '',
    travelDate,
    duration: Number(searchParams.get('duration') ?? '3'),
  }
}

function getConditionLabel(label: string, value: string) {
  return value ? `${label} ${value}` : `${label} 전체`
}

function buildAssistantReply(
  request: AssistantRequest,
  retrievedPosts: PostWithMeta[],
  weatherHeadline: string,
) {
  const focus = [
    request.region || '지역 미정',
    request.theme || '테마 미정',
    request.companion || '동행 미정',
  ]
    .filter(Boolean)
    .join(' · ')

  if (!retrievedPosts.length) {
    return `${focus} 기준으로 바로 맞는 후기는 적었어요. 대신 입력한 조건을 바탕으로 일정 방향을 먼저 잡아뒀어요. ${weatherHeadline}`
  }

  return `입력한 조건과 비슷한 후기 ${retrievedPosts.length}개를 참고해서 추천 방향을 정리했어요. ${retrievedPosts[0].title} 같은 글을 우선 보면 좋아요. ${weatherHeadline}`
}

export function ChatPage({ posts }: ChatPageProps) {
  const [searchParams] = useSearchParams()
  const [request, setRequest] = useState<AssistantRequest>(() => getInitialRequest(searchParams))
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: '원하는 여행 조건을 입력하면 후기 기반 추천, 날씨 요약, 플래너 초안까지 한 화면에서 정리해드릴게요.',
    },
  ])
  const [sessions] = useState([
    '여름에 친구랑 바다 보러 가기 좋은 곳 추천해줘',
    '가을에 커플로 걷기 좋은 여행지 알려줘',
    '부모님이랑 1박 2일로 가기 좋은 국내 여행지 추천해줘',
    '비 오는 날에도 괜찮은 실내 여행 코스 알려줘',
  ])

  const retrievedPosts = useMemo(() => retrieveRelevantPosts(posts, request, 4), [posts, request])
  const weather = useMemo(() => buildWeatherInsight(request), [request])
  const plan = useMemo(() => buildAgentPlan(request, retrievedPosts).slice(0, 2), [request, retrievedPosts])

  const plannerHref = useMemo(() => {
    const params = new URLSearchParams({
      q: request.query,
      region: request.region,
      budget: request.budget,
      theme: request.theme,
      season: request.season,
      companion: request.companion,
      travelDate: request.travelDate,
      duration: String(request.duration),
    })
    return `/planner?${params.toString()}`
  }, [request])

  const conditionChips = [
    getConditionLabel('지역', request.region),
    getConditionLabel('예산', request.budget),
    getConditionLabel('테마', request.theme),
    getConditionLabel('계절', request.season),
    getConditionLabel('동행', request.companion),
  ]

  const summaryStats = [
    { label: '참고 후기', value: `${retrievedPosts.length}개` },
    { label: '여행 길이', value: `${request.duration}일` },
    { label: '추천 계절', value: request.season || inferSeasonFromDate(request.travelDate) || '미정' },
  ]

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedQuery = request.query.trim()
    if (!trimmedQuery) {
      return
    }

    setMessages((current) => [
      ...current,
      { role: 'user', text: trimmedQuery },
      {
        role: 'assistant',
        text: buildAssistantReply(request, retrievedPosts, weather.headline),
      },
    ])
  }

  return (
    <main className="page chat-page">
      <section className="chat-hero">
        <div className="chat-hero__copy">
          <span>travel assistant</span>
          <h1>후기 기반으로 바로 읽히는 여행 추천 챗봇</h1>
          <p>
            막연한 질문 한 줄만 적어도 관련 후기, 계절감, 여행 분위기, 플래너 초안까지
            한 번에 정리해주는 화면으로 다시 구성했습니다.
          </p>
        </div>
        <div className="chat-hero__stats">
          {summaryStats.map((item) => (
            <div className="chat-stat-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="chat-layout">
        <aside className="chat-sidebar">
          <div className="chat-panel chat-panel--dark">
            <span>빠른 시작</span>
            <h2>바로 써보기</h2>
            <p>자주 쓰는 질문 톤을 눌러서 빠르게 시작할 수 있습니다.</p>
            <div className="chat-session-list">
              {sessions.map((session) => (
                <button
                  className="chat-session-button"
                  key={session}
                  type="button"
                  onClick={() =>
                    setRequest((current) => ({
                      ...current,
                      query: session,
                    }))
                  }
                >
                  {session}
                </button>
              ))}
            </div>
          </div>

          <div className="chat-panel">
            <span>현재 조건</span>
            <h2>필터 요약</h2>
            <div className="chat-chip-list">
              {conditionChips.map((chip) => (
                <span className="chat-chip" key={chip}>
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </aside>

        <section className="chat-shell">
          <div className="chat-shell__header">
            <span>추천 요청</span>
            <h2>원하는 여행 스타일을 입력해보세요</h2>
            <p>
              예산, 계절, 동행 조건이 없더라도 괜찮습니다. 자연어 질문과 몇 가지 조건만
              있으면 추천 결과를 바로 만들 수 있습니다.
            </p>
          </div>

          <form className="chat-request-form" onSubmit={handleSubmit}>
            <label className="chat-form-lead">
              <span>질문</span>
              <textarea
                placeholder="예: 여름에 친구랑 10~20만원대로 갈 만한 바다 여행지 추천해줘"
                value={request.query}
                onChange={(event) =>
                  setRequest((current) => ({ ...current, query: event.target.value }))
                }
              />
            </label>

            <div className="chat-filter-grid">
              <label>
                <span>지역</span>
                <input
                  placeholder="예: 강릉, 여수, 제주"
                  value={request.region}
                  onChange={(event) =>
                    setRequest((current) => ({ ...current, region: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>예산</span>
                <input
                  placeholder="예: 10~20만원"
                  value={request.budget}
                  onChange={(event) =>
                    setRequest((current) => ({ ...current, budget: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>테마</span>
                <input
                  placeholder="예: 힐링, 미식, 드라이브"
                  value={request.theme}
                  onChange={(event) =>
                    setRequest((current) => ({ ...current, theme: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>동행</span>
                <input
                  placeholder="예: 친구, 커플, 가족"
                  value={request.companion}
                  onChange={(event) =>
                    setRequest((current) => ({ ...current, companion: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>여행일</span>
                <input
                  type="date"
                  value={request.travelDate}
                  onChange={(event) =>
                    setRequest((current) => ({
                      ...current,
                      travelDate: event.target.value,
                      season: inferSeasonFromDate(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>여행 기간</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={request.duration}
                  onChange={(event) =>
                    setRequest((current) => ({
                      ...current,
                      duration: Number(event.target.value) || 1,
                    }))
                  }
                />
              </label>
            </div>

            <div className="chat-request-actions">
              <button className="primary-button chat-action-button" type="submit">
                추천 받기
              </button>
              <Link className="secondary-button chat-action-button" to={plannerHref}>
                플래너로 이어가기
              </Link>
            </div>
          </form>

          <div className="chat-response-grid">
            <article className="chat-highlight-card">
              <span>추천 한 줄 요약</span>
              <strong>
                {retrievedPosts[0]?.title ?? '조건에 맞는 여행 방향을 먼저 정리해드릴게요.'}
              </strong>
              <p>{weather.travelVerdict}</p>
            </article>
            <article className="chat-highlight-card">
              <span>날씨 메모</span>
              <strong>{weather.temperature}</strong>
              <p>{weather.caution}</p>
            </article>
          </div>

          <div className="chat-window">
            <div className="chat-window__header">
              <strong>대화 로그</strong>
              <span>질문과 추천 요약이 이곳에 쌓입니다.</span>
            </div>
            {messages.map((item, index) => (
              <div className={`chat-bubble ${item.role}`} key={`${item.role}-${index}`}>
                {item.role === 'assistant' ? <em>AI 추천</em> : <em>내 질문</em>}
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <aside className="chat-evidence">
          <section className="chat-panel">
            <span>참고 후기</span>
            <h2>비슷한 게시글</h2>
            <div className="evidence-list">
              {retrievedPosts.length ? (
                retrievedPosts.map((post) => (
                  <Link className="evidence-card" key={post.id} to={`/posts/${post.id}`}>
                    <strong>{post.title}</strong>
                    <span>
                      {post.region} · {post.theme} · {post.companion}
                    </span>
                    <p>{post.summary}</p>
                  </Link>
                ))
              ) : (
                <div className="chat-empty-card">
                  아직 완전히 맞는 후기는 적지만, 아래 플래너 초안은 바로 참고할 수 있습니다.
                </div>
              )}
            </div>
          </section>

          <section className="chat-panel">
            <span>날씨 체크</span>
            <h2>여행 메모</h2>
            <div className="weather-card">
              <strong>{weather.headline}</strong>
              <p>{weather.travelVerdict}</p>
              <span>{weather.temperature}</span>
              <small>{weather.caution}</small>
            </div>
          </section>

          <section className="chat-panel">
            <span>일정 초안</span>
            <h2>플래너 미리보기</h2>
            <div className="mini-plan-list">
              {plan.map((day) => (
                <div className="mini-plan-card" key={day.dayLabel}>
                  <div className="mini-plan-card__top">
                    <strong>{day.dayLabel}</strong>
                    <span>{day.theme}</span>
                  </div>
                  <p>{day.stops[0]?.description}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}
