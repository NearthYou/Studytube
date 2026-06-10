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

function getInitialRequest(searchParams: URLSearchParams): AssistantRequest {
  const travelDate = searchParams.get('travelDate') ?? '2026-07-12'
  return {
    query: searchParams.get('q') ?? '여름에 친구랑 갈 만한 10-20만원 바다 여행지 추천해줘',
    region: searchParams.get('region') ?? '',
    budget: searchParams.get('budget') ?? '',
    theme: searchParams.get('theme') ?? '',
    season: searchParams.get('season') ?? inferSeasonFromDate(travelDate),
    companion: searchParams.get('companion') ?? '',
    travelDate,
    duration: Number(searchParams.get('duration') ?? '3'),
  }
}

export function ChatPage({ posts }: ChatPageProps) {
  const [searchParams] = useSearchParams()
  const [request, setRequest] = useState<AssistantRequest>(() => getInitialRequest(searchParams))
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'RAG 검색 결과, MCP 날씨 판단, Agent 일정 초안이 오른쪽 패널에 같이 정리됩니다.',
    },
  ])
  const [sessions] = useState([
    '여름 국내 바다 여행',
    '가을 커플 여행 추천',
    '가족과 제주 일정',
    '비 오는 날 실내 여행',
  ])

  const retrievedPosts = useMemo(
    () => retrieveRelevantPosts(posts, request, 4),
    [posts, request],
  )
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

  return (
    <main className="page chat-page">
      <section className="chat-layout">
        <aside className="chat-sidebar">
          <div className="chat-panel">
            <span>SESSIONS</span>
            <h2>대화 세션</h2>
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
        </aside>

        <section className="chat-shell">
          <div className="chat-shell__header">
            <span>TRAVEL RECOMMEND BOT</span>
            <h1>여행추천봇</h1>
            <p>왼쪽은 세션, 가운데는 대화, 오른쪽은 RAG/MCP/Agent 결과 패널로 구성했습니다.</p>
          </div>
          <form
            className="chat-request-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!request.query.trim()) {
                return
              }
              setMessages((current) => [
                ...current,
                { role: 'user', text: request.query.trim() },
                {
                  role: 'assistant',
                  text: `게시글 ${retrievedPosts.length}개를 참고했고, ${weather.headline} 기준으로 추천과 일정 초안을 정리했습니다.`,
                },
              ])
            }}
          >
            <div className="chat-filter-grid">
              <label>
                질문
                <textarea
                  value={request.query}
                  onChange={(event) =>
                    setRequest((current) => ({ ...current, query: event.target.value }))
                  }
                />
              </label>
              <label>
                지역
                <input
                  value={request.region}
                  onChange={(event) =>
                    setRequest((current) => ({ ...current, region: event.target.value }))
                  }
                />
              </label>
              <label>
                예산
                <input
                  value={request.budget}
                  onChange={(event) =>
                    setRequest((current) => ({ ...current, budget: event.target.value }))
                  }
                />
              </label>
              <label>
                테마
                <input
                  value={request.theme}
                  onChange={(event) =>
                    setRequest((current) => ({ ...current, theme: event.target.value }))
                  }
                />
              </label>
              <label>
                동행
                <input
                  value={request.companion}
                  onChange={(event) =>
                    setRequest((current) => ({ ...current, companion: event.target.value }))
                  }
                />
              </label>
              <label>
                여행일
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
            </div>
            <div className="chat-request-actions">
              <button className="primary-button" type="submit">
                RAG + MCP + Agent 실행
              </button>
              <Link className="secondary-button" to={plannerHref}>
                플래너로 이어가기
              </Link>
            </div>
          </form>

          <div className="chat-window">
            {messages.map((item, index) => (
              <div className={`chat-bubble ${item.role}`} key={`${item.role}-${index}`}>
                {item.text}
              </div>
            ))}
          </div>
        </section>

        <aside className="chat-evidence">
          <section className="chat-panel">
            <span>RAG</span>
            <h2>참고 게시글</h2>
            <div className="evidence-list">
              {retrievedPosts.map((post) => (
                <Link className="evidence-card" key={post.id} to={`/posts/${post.id}`}>
                  <strong>{post.title}</strong>
                  <span>
                    {post.region} · {post.theme} · {post.companion}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="chat-panel">
            <span>MCP</span>
            <h2>날씨 판단</h2>
            <div className="weather-card">
              <strong>{weather.headline}</strong>
              <p>{weather.travelVerdict}</p>
              <span>{weather.temperature}</span>
              <small>{weather.caution}</small>
            </div>
          </section>

          <section className="chat-panel">
            <span>AGENT</span>
            <h2>일정 초안</h2>
            <div className="mini-plan-list">
              {plan.map((day) => (
                <div className="mini-plan-card" key={day.dayLabel}>
                  <strong>{day.dayLabel}</strong>
                  <span>{day.theme}</span>
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
