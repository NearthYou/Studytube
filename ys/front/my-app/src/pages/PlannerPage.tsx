import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { PostWithMeta, User } from '../types/community'
import { requestTravelPlan, type AiPlanResponse, type TravelAgentRequest } from '../utils/aiAPI'
import { localizeLookupValue } from '../utils/i18n'
import type { Language } from '../utils/language'
import { fetchPosts } from '../utils/postsApi'
import { createTravelAgentSearchParams, inferSeasonCodeFromDate } from '../utils/travelParams'
import '../styles/pages/PlannerPage.css'

type PlannerPageProps = {
  currentUser: User
  posts: PostWithMeta[]
  language: Language
}

const COPY = {
  ko: {
    eyebrow: 'AI planner',
    hero: '',
    planningRequest: '여행 조건',
    tripRequest: '여행 요청',
    region: '지역',
    budget: '예산',
    theme: '테마',
    travelDate: '여행 날짜',
    duration: '기간',
    balanced: '균형형',
    budgetMode: '예산형',
    slow: '여유형',
    generating: '생성 중...',
    generatePlan: '일정 만들기',
    backToChat: 'AI 상담',
    plannerFallbackPrefix: '게시글',
    planTitle: '일정',
    planPlaceholder: '일정을 만들어 보세요.',
    groundingContext: '참고 정보',
    weatherSummary: '날씨 요약',
    noWeather: '아직 날씨 메모가 없습니다.',
    noTemperature: '온도 정보 없음',
    noCaution: '주의 사항 없음',
    retrievedPosts: '선택된 게시글',
    retrievedPlaceholder: '플래너 실행 후 참고 게시글이 여기에 표시됩니다.',
    aiError: 'AI 일정 요청에 실패했습니다.',
    titleSuffix: '님의 여행 일정',
  },
  en: {
    eyebrow: 'AI planner',
    hero: '',
    planningRequest: 'Trip filters',
    tripRequest: 'trip request',
    region: 'region',
    budget: 'budget',
    theme: 'theme',
    travelDate: 'travel date',
    duration: 'duration',
    balanced: 'balanced',
    budgetMode: 'budget',
    slow: 'slow',
    generating: 'Generating...',
    generatePlan: 'Create plan',
    backToChat: 'AI chat',
    plannerFallbackPrefix: 'Posts',
    planTitle: 'Itinerary',
    planPlaceholder: 'Create an itinerary.',
    groundingContext: 'References',
    weatherSummary: 'weather summary',
    noWeather: 'No weather note yet.',
    noTemperature: 'No temperature data',
    noCaution: 'No caution note yet',
    retrievedPosts: 'retrieved posts',
    retrievedPlaceholder: 'Retrieved posts will appear here after the planner runs.',
    aiError: 'AI plan request failed.',
    titleSuffix: "'s itinerary",
  },
} satisfies Record<Language, Record<string, string>>

function getInitialRequest(searchParams: URLSearchParams, language: Language): TravelAgentRequest {
  const travelDate = searchParams.get('travelDate') ?? '2026-07-12'
  return {
    query: searchParams.get('q') ?? (language === 'ko' ? '바다 여행을 추천해 줘.' : 'Recommend a sea trip.'),
    region: searchParams.get('region') ?? '',
    budget: searchParams.get('budget') ?? '',
    theme: searchParams.get('theme') ?? '',
    season: searchParams.get('season') ?? inferSeasonCodeFromDate(travelDate),
    companion: searchParams.get('companion') ?? '',
    travelDate,
    duration: Number(searchParams.get('duration') ?? '3'),
    planStyle: 'balanced',
  }
}

export function PlannerPage({ currentUser, posts, language }: PlannerPageProps) {
  const copy = COPY[language]
  const [searchParams] = useSearchParams()
  const [request, setRequest] = useState<TravelAgentRequest>(() => getInitialRequest(searchParams, language))
  const [planStyle, setPlanStyle] = useState<'balanced' | 'budget' | 'slow'>('balanced')
  const [result, setResult] = useState<AiPlanResponse | null>(null)
  const [totalPostCount, setTotalPostCount] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const chatHref = useMemo(() => {
    const params = createTravelAgentSearchParams(request)
    return `/chat?${params.toString()}`
  }, [request])

  useEffect(() => {
    let isMounted = true

    const loadTotalPostCount = async () => {
      try {
        const response = await fetchPosts({
          page: 1,
          limit: 1,
        })

        if (isMounted) {
          setTotalPostCount(response.totalCount)
        }
      } catch {
        if (isMounted) {
          setTotalPostCount(posts.length)
        }
      }
    }

    void loadTotalPostCount()

    return () => {
      isMounted = false
    }
  }, [posts.length])

  const handleGeneratePlan = async () => {
    if (isLoading || !request.query.trim()) {
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await requestTravelPlan({
        ...request,
        language,
        planStyle,
      })
      setResult(response)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.aiError)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="page planner-page">
      <section className="planner-hero">
        <span>{copy.eyebrow}</span>
        <h1>{`${currentUser.nickname}${copy.titleSuffix}`}</h1>
        {copy.hero ? <p>{copy.hero}</p> : null}
      </section>

      <section className="planner-grid">
        <article className="planner-card planner-card--controls">
          <h2>{copy.planningRequest}</h2>
          <div className="planner-form">
            <label>
              {copy.tripRequest}
              <textarea value={request.query} onChange={(event) => setRequest((current) => ({ ...current, query: event.target.value }))} />
            </label>
            <label>
              {copy.region}
              <input value={request.region} onChange={(event) => setRequest((current) => ({ ...current, region: event.target.value }))} />
            </label>
            <label>
              {copy.budget}
              <input value={request.budget} onChange={(event) => setRequest((current) => ({ ...current, budget: event.target.value }))} />
            </label>
            <label>
              {copy.theme}
              <input value={request.theme} onChange={(event) => setRequest((current) => ({ ...current, theme: event.target.value }))} />
            </label>
            <label>
              {copy.travelDate}
              <input
                type="date"
                value={request.travelDate}
                onChange={(event) =>
                  setRequest((current) => ({
                    ...current,
                    travelDate: event.target.value,
                    season: inferSeasonCodeFromDate(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              {copy.duration}
              <input
                max={5}
                min={1}
                type="number"
                value={request.duration}
                onChange={(event) => setRequest((current) => ({ ...current, duration: Number(event.target.value || '1') }))}
              />
            </label>
          </div>
          <div className="planner-style">
            <button className={planStyle === 'balanced' ? 'active' : ''} type="button" onClick={() => setPlanStyle('balanced')}>
              {copy.balanced}
            </button>
            <button className={planStyle === 'budget' ? 'active' : ''} type="button" onClick={() => setPlanStyle('budget')}>
              {copy.budgetMode}
            </button>
            <button className={planStyle === 'slow' ? 'active' : ''} type="button" onClick={() => setPlanStyle('slow')}>
              {copy.slow}
            </button>
          </div>
          <button className="primary-button" type="button" onClick={handleGeneratePlan} disabled={isLoading}>
            {isLoading ? copy.generating : copy.generatePlan}
          </button>
          <Link className="secondary-button" to={chatHref}>
            {copy.backToChat}
          </Link>
          <p>{result?.retrieval_summary ?? `${copy.plannerFallbackPrefix} ${totalPostCount ?? posts.length}`}</p>
          {error ? <p className="status-note status-note--error">{error}</p> : null}
        </article>

        <article className="planner-card planner-card--schedule">
          <h2>{copy.planTitle}</h2>
          <div className="planner-days">
            {result?.plan.length ? (
              result.plan.map((day) => (
                <section className="planner-day" key={day.day_label}>
                  <header>
                    <strong>{day.day_label}</strong>
                    <span>{day.theme}</span>
                  </header>
                  {day.stops.map((stop) => (
                    <div className="planner-stop" key={`${day.day_label}-${stop.time}-${stop.title}`}>
                      <span>{stop.time}</span>
                      <div>
                        <strong>{stop.title}</strong>
                        <p>{stop.description}</p>
                        <small>{stop.estimated_cost}</small>
                      </div>
                    </div>
                  ))}
                </section>
              ))
            ) : (
              <p>{copy.planPlaceholder}</p>
            )}
          </div>
        </article>

        <article className="planner-card planner-card--context">
          <h2>{copy.groundingContext}</h2>
          <div className="planner-weather">
            <strong>{copy.weatherSummary}</strong>
            <p>{result?.weather.headline ?? copy.noWeather}</p>
            <span>{result?.weather.temperature ?? copy.noTemperature}</span>
            <small>{result?.weather.caution ?? copy.noCaution}</small>
          </div>
          <div className="planner-sources">
            <strong>{copy.retrievedPosts}</strong>
            {result?.sources.length ? (
              result.sources.map((source) => (
                <Link className="planner-source" key={source.post_id} to={`/posts/${source.post_id}`}>
                  <strong>{source.title}</strong>
                  <span>
                    {localizeLookupValue('region', source.region, language)} · {localizeLookupValue('theme', source.theme, language)} · {localizeLookupValue('companion', source.companion, language)}
                  </span>
                </Link>
              ))
            ) : (
              <p>{copy.retrievedPlaceholder}</p>
            )}
          </div>
        </article>
      </section>
    </main>
  )
}
