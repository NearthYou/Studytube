import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { PostWithMeta, User } from '../types/community'
import {
  buildAgentPlan,
  buildWeatherInsight,
  inferSeasonFromDate,
  retrieveRelevantPosts,
  type AssistantRequest,
} from '../utils/travelAssistant'
import '../styles/pages/PlannerPage.css'

type PlannerPageProps = {
  currentUser: User
  posts: PostWithMeta[]
}

function getInitialRequest(searchParams: URLSearchParams): AssistantRequest {
  const travelDate = searchParams.get('travelDate') ?? '2026-07-12'
  return {
    query: searchParams.get('q') ?? '바다 여행 추천',
    region: searchParams.get('region') ?? '',
    budget: searchParams.get('budget') ?? '',
    theme: searchParams.get('theme') ?? '',
    season: searchParams.get('season') ?? inferSeasonFromDate(travelDate),
    companion: searchParams.get('companion') ?? '',
    travelDate,
    duration: Number(searchParams.get('duration') ?? '3'),
  }
}

export function PlannerPage({ currentUser, posts }: PlannerPageProps) {
  const [searchParams] = useSearchParams()
  const [request, setRequest] = useState<AssistantRequest>(() => getInitialRequest(searchParams))
  const [planStyle, setPlanStyle] = useState<'balanced' | 'budget' | 'slow'>('balanced')

  const retrievedPosts = useMemo(
    () => retrieveRelevantPosts(posts, request, 3),
    [posts, request],
  )
  const weather = useMemo(() => buildWeatherInsight(request), [request])
  const plan = useMemo(() => buildAgentPlan(request, retrievedPosts), [request, retrievedPosts])

  return (
    <main className="page planner-page">
      <section className="planner-hero">
        <span>AI TRAVEL PLANNER</span>
        <h1>{currentUser.nickname}님의 여행 플래너</h1>
        <p>RAG로 유사 게시글을 찾고, MCP 날씨 정보를 반영하고, Agent가 일정 초안을 구성하는 흐름을 한 화면에 정리했습니다.</p>
      </section>

      <section className="planner-grid">
        <article className="planner-card planner-card--controls">
          <h2>계획 조건</h2>
          <div className="planner-form">
            <label>
              여행 요청
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
            <label>
              일정 길이
              <input
                max={5}
                min={1}
                type="number"
                value={request.duration}
                onChange={(event) =>
                  setRequest((current) => ({
                    ...current,
                    duration: Number(event.target.value || '1'),
                  }))
                }
              />
            </label>
          </div>
          <div className="planner-style">
            <button
              className={planStyle === 'balanced' ? 'active' : ''}
              type="button"
              onClick={() => setPlanStyle('balanced')}
            >
              균형형
            </button>
            <button
              className={planStyle === 'budget' ? 'active' : ''}
              type="button"
              onClick={() => setPlanStyle('budget')}
            >
              예산 절약형
            </button>
            <button
              className={planStyle === 'slow' ? 'active' : ''}
              type="button"
              onClick={() => setPlanStyle('slow')}
            >
              느긋한 일정형
            </button>
          </div>
          <Link className="secondary-button" to="/chat">
            챗봇으로 돌아가기
          </Link>
        </article>

        <article className="planner-card planner-card--schedule">
          <h2>Agent 일정 초안</h2>
          <div className="planner-days">
            {plan.map((day) => (
              <section className="planner-day" key={day.dayLabel}>
                <header>
                  <strong>{day.dayLabel}</strong>
                  <span>{day.theme}</span>
                </header>
                {day.stops.map((stop) => (
                  <div className="planner-stop" key={`${day.dayLabel}-${stop.time}-${stop.title}`}>
                    <span>{stop.time}</span>
                    <div>
                      <strong>{stop.title}</strong>
                      <p>{stop.description}</p>
                      <small>
                        {planStyle === 'budget'
                          ? '비용 절약 우선'
                          : planStyle === 'slow'
                            ? '이동 최소화 우선'
                            : stop.estimatedCost}
                      </small>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </article>

        <article className="planner-card planner-card--context">
          <h2>추천 근거</h2>
          <div className="planner-weather">
            <strong>MCP 날씨 판단</strong>
            <p>{weather.headline}</p>
            <span>{weather.temperature}</span>
            <small>{weather.caution}</small>
          </div>
          <div className="planner-sources">
            <strong>RAG 참고 게시글</strong>
            {retrievedPosts.map((post) => (
              <Link className="planner-source" key={post.id} to={`/posts/${post.id}`}>
                <strong>{post.title}</strong>
                <span>
                  {post.region} · {post.theme} · {post.companion}
                </span>
              </Link>
            ))}
          </div>
        </article>
      </section>
    </main>
  )
}
