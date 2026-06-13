import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import MarkdownMessage from '../components/MarkdownMessage'
import type { PostWithMeta } from '../types/community'
import {
  requestTravelChat,
  type AiAgentResponse,
  type TravelAgentRequest,
} from '../utils/aiAPI'
import { localizeLookupValue } from '../utils/i18n'
import type { Language } from '../utils/language'
import '../styles/pages/ChatPage.css'

type ChatPageProps = {
  posts: PostWithMeta[]
  language: Language
}

type Message = {
  role: 'assistant' | 'user'
  text: string
}

type ChatPreferences = {
  region: string
  budget: string
  theme: string
  season: string
  companion: string
  travelDate: string
  duration: number
}

type PersistedChatState = {
  draft: string
  sessionId: string
  preferences: ChatPreferences
  messages: Message[]
  result: AiAgentResponse | null
}

const STORAGE_PREFIX = 'tripy-chat-state'

function inferSeasonFromDate(travelDate: string) {
  if (!travelDate) {
    return ''
  }

  const month = new Date(travelDate).getMonth() + 1
  if ([3, 4, 5].includes(month)) {
    return 'spring'
  }
  if ([6, 7, 8].includes(month)) {
    return 'summer'
  }
  if ([9, 10, 11].includes(month)) {
    return 'fall'
  }

  return 'winter'
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const COPY = {
  ko: {
    eyebrow: 'Travel Agent',
    title: '대화형 여행 챗봇',
    body:
      '그냥 말하듯 물어보면 됩니다. MCP로 게시글과 댓글을 찾고, RAG 근거를 모아서 여행 답변처럼 이어서 대화합니다.',
    quickPrompts: [
      '부산에서 친구랑 1박 2일로 가볍게 놀기 좋은 코스 추천해줘.',
      '제주에서 부모님 모시고 가기 편한 여행으로 짜줘.',
      '비 와도 괜찮은 실내 위주 여행지 추천해줘.',
      '예산 20만원 안에서 혼자 힐링 여행 갈 만한 곳 있을까?',
    ],
    quickTitle: '바로 시작',
    newChat: '새 대화',
    planner: '플래너 열기',
    preferences: '여행 설정',
    preferencesBody: '필요할 때만 보조 조건을 넣어주세요. 대화만으로도 추천은 가능합니다.',
    region: '지역',
    budget: '예산',
    theme: '테마',
    companion: '동행',
    travelDate: '여행일',
    duration: '기간',
    placeholder: '예: 강릉에서 혼자 조용히 쉬고 싶은데 카페랑 바다 위주로 추천해줘',
    send: '보내기',
    sending: '답변 중...',
    session: '현재 세션',
    sessionBody: '같은 세션 안에서는 이전 대화를 이어서 반영합니다.',
    sourceSummary: '근거 요약',
    weather: '날씨 메모',
    sources: '참고 게시글',
    trace: '도구 사용',
    plan: '일정 미리보기',
    emptySources: '아직 참고 게시글이 없습니다.',
    emptyPlan: '답변이 오면 일정 초안이 여기에 보입니다.',
    emptySummary: '대화를 시작하면 검색 요약이 여기에 표시됩니다.',
    emptyWeather: '대화를 시작하면 날씨 메모가 여기에 표시됩니다.',
    user: '나',
    assistant: 'Tripy',
    enterHint: 'Enter 전송, Shift+Enter 줄바꿈',
    sourceCount: '참고 문서',
    turnCount: '대화 턴',
    durationCount: '여행 일수',
    any: '전체',
  },
  en: {
    eyebrow: 'Travel Agent',
    title: 'Conversational travel chatbot',
    body:
      'Ask naturally. The agent uses MCP to retrieve posts and comments, grounds the answer with RAG, and continues the conversation turn by turn.',
    quickPrompts: [
      'Recommend a light 2-day Busan trip for friends.',
      'Plan a Jeju trip that works well for parents.',
      'Suggest an indoor-friendly trip for a rainy day.',
      'Where can I go alone for a calm trip under 200k KRW?',
    ],
    quickTitle: 'Quick start',
    newChat: 'New chat',
    planner: 'Open planner',
    preferences: 'Trip settings',
    preferencesBody: 'Add optional constraints here. The chatbot also works with natural conversation only.',
    region: 'Region',
    budget: 'Budget',
    theme: 'Theme',
    companion: 'Companion',
    travelDate: 'Travel date',
    duration: 'Duration',
    placeholder: 'Example: I want a calm solo trip in Gangneung with cafes and sea views.',
    send: 'Send',
    sending: 'Thinking...',
    session: 'Current session',
    sessionBody: 'The chatbot continues to use prior turns inside the same session.',
    sourceSummary: 'Grounded summary',
    weather: 'Weather note',
    sources: 'Source posts',
    trace: 'Tool trace',
    plan: 'Plan preview',
    emptySources: 'Source posts will appear after the first answer.',
    emptyPlan: 'A draft itinerary will appear after the first answer.',
    emptySummary: 'The retrieval summary will appear here after the conversation starts.',
    emptyWeather: 'The weather note will appear here after the conversation starts.',
    user: 'You',
    assistant: 'Tripy',
    enterHint: 'Enter to send, Shift+Enter for a new line',
    sourceCount: 'grounded sources',
    turnCount: 'chat turns',
    durationCount: 'trip days',
    any: 'any',
  },
} satisfies Record<Language, {
  eyebrow: string
  title: string
  body: string
  quickPrompts: string[]
  quickTitle: string
  newChat: string
  planner: string
  preferences: string
  preferencesBody: string
  region: string
  budget: string
  theme: string
  companion: string
  travelDate: string
  duration: string
  placeholder: string
  send: string
  sending: string
  session: string
  sessionBody: string
  sourceSummary: string
  weather: string
  sources: string
  trace: string
  plan: string
  emptySources: string
  emptyPlan: string
  emptySummary: string
  emptyWeather: string
  user: string
  assistant: string
  enterHint: string
  sourceCount: string
  turnCount: string
  durationCount: string
  any: string
}>

function buildInitialPreferences(searchParams: URLSearchParams): ChatPreferences {
  const travelDate = searchParams.get('travelDate') ?? '2026-07-12'

  return {
    region: searchParams.get('region') ?? '',
    budget: searchParams.get('budget') ?? '',
    theme: searchParams.get('theme') ?? '',
    season: searchParams.get('season') ?? inferSeasonFromDate(travelDate),
    companion: searchParams.get('companion') ?? '',
    travelDate,
    duration: Number(searchParams.get('duration') ?? '3'),
  }
}

function buildInitialDraft(searchParams: URLSearchParams, language: Language) {
  return (
    searchParams.get('q') ??
    (language === 'ko'
      ? '부산에서 친구랑 갈 만한 여행 추천해줘.'
      : 'Recommend a trip in Busan for friends.')
  )
}

function getStorageKey(language: Language) {
  return `${STORAGE_PREFIX}-${language}`
}

function createIntroMessages(language: Language): Message[] {
  return [
    {
      role: 'assistant',
      text:
        language === 'ko'
          ? '안녕하세요. 여행 조건을 편하게 말해주시면, 커뮤니티 글과 댓글을 바탕으로 이어서 추천해드릴게요.'
          : 'Tell me what kind of trip you want, and I will continue the conversation with grounded travel recommendations.',
    },
  ]
}

function readPersistedState(
  language: Language,
  searchParams: URLSearchParams,
): PersistedChatState {
  const fallbackState: PersistedChatState = {
    draft: buildInitialDraft(searchParams, language),
    sessionId: createSessionId(),
    preferences: buildInitialPreferences(searchParams),
    messages: createIntroMessages(language),
    result: null,
  }

  if (typeof window === 'undefined') {
    return fallbackState
  }

  const raw = window.localStorage.getItem(getStorageKey(language))
  if (!raw) {
    return fallbackState
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedChatState>
    return {
      draft: typeof parsed.draft === 'string' ? parsed.draft : fallbackState.draft,
      sessionId:
        typeof parsed.sessionId === 'string' && parsed.sessionId
          ? parsed.sessionId
          : fallbackState.sessionId,
      preferences: parsed.preferences
        ? { ...fallbackState.preferences, ...parsed.preferences }
        : fallbackState.preferences,
      messages:
        Array.isArray(parsed.messages) && parsed.messages.length
          ? parsed.messages.filter(
              (item): item is Message =>
                !!item &&
                (item.role === 'assistant' || item.role === 'user') &&
                typeof item.text === 'string',
            )
          : fallbackState.messages,
      result: parsed.result ?? null,
    }
  } catch {
    return fallbackState
  }
}

export function ChatPage({ posts: _posts, language }: ChatPageProps) {
  const copy = COPY[language]
  const [searchParams] = useSearchParams()
  const [draft, setDraft] = useState(() => readPersistedState(language, searchParams).draft)
  const [sessionId, setSessionId] = useState(
    () => readPersistedState(language, searchParams).sessionId,
  )
  const [preferences, setPreferences] = useState<ChatPreferences>(
    () => readPersistedState(language, searchParams).preferences,
  )
  const [messages, setMessages] = useState<Message[]>(
    () => readPersistedState(language, searchParams).messages,
  )
  const [result, setResult] = useState<AiAgentResponse | null>(
    () => readPersistedState(language, searchParams).result,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPreferences, setShowPreferences] = useState(false)
  const threadEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const next = readPersistedState(language, searchParams)
    setDraft(next.draft)
    setSessionId(next.sessionId)
    setPreferences(next.preferences)
    setMessages(next.messages)
    setResult(next.result)
    setError('')
  }, [language, searchParams])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const payload: PersistedChatState = {
      draft,
      sessionId,
      preferences,
      messages,
      result,
    }
    window.localStorage.setItem(getStorageKey(language), JSON.stringify(payload))
  }, [draft, language, messages, preferences, result, sessionId])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [isLoading, messages, result])

  const plannerHref = useMemo(() => {
    const params = new URLSearchParams({
      q: draft || messages.at(-1)?.text || '',
      region: preferences.region,
      budget: preferences.budget,
      theme: preferences.theme,
      season: preferences.season,
      companion: preferences.companion,
      travelDate: preferences.travelDate,
      duration: String(preferences.duration),
    })
    return `/planner?${params.toString()}`
  }, [draft, messages, preferences])

  const conditionChips = [
    preferences.region || `${copy.region} ${copy.any}`,
    preferences.budget || `${copy.budget} ${copy.any}`,
    preferences.theme || `${copy.theme} ${copy.any}`,
    preferences.companion || `${copy.companion} ${copy.any}`,
  ]

  const summaryStats = [
    { label: copy.turnCount, value: `${Math.max(0, messages.length - 1)}` },
    { label: copy.sourceCount, value: `${result?.sources.length ?? 0}` },
    { label: copy.durationCount, value: `${preferences.duration}` },
  ]

  const sendMessage = async (nextText?: string) => {
    const trimmedQuery = (nextText ?? draft).trim()
    if (!trimmedQuery || isLoading) {
      return
    }

    const payload: TravelAgentRequest = {
      query: trimmedQuery,
      sessionId,
      region: preferences.region,
      budget: preferences.budget,
      theme: preferences.theme,
      season: preferences.season,
      companion: preferences.companion,
      travelDate: preferences.travelDate,
      duration: preferences.duration,
      language,
    }

    setIsLoading(true)
    setError('')
    setDraft('')
    setMessages((current) => [...current, { role: 'user', text: trimmedQuery }])

    try {
      const response = await requestTravelChat(payload)
      if (response.session_id) {
        setSessionId(response.session_id)
      }
      setResult(response)
      setMessages((current) => [...current, { role: 'assistant', text: response.answer }])
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'AI request failed.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await sendMessage()
  }

  const handleResetChat = () => {
    const nextSessionId = createSessionId()
    setSessionId(nextSessionId)
    setDraft(buildInitialDraft(searchParams, language))
    setMessages(createIntroMessages(language))
    setResult(null)
    setError('')
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(getStorageKey(language))
    }
  }

  return (
    <main className="page chat-page">
      <section className="chat-hero">
        <div className="chat-hero__copy">
          <span>{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <div className="chat-chip-list">
            {conditionChips.map((chip) => (
              <span className="chat-chip" key={chip}>
                {chip}
              </span>
            ))}
          </div>
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
        <section className="chat-shell">
          <div className="chat-shell__header">
            <div>
              <span>{copy.session}</span>
              <h2>{copy.sessionBody}</h2>
            </div>
            <div className="chat-shell__actions">
              <button
                className="secondary-button chat-header-button"
                type="button"
                onClick={() => setShowPreferences((current) => !current)}
              >
                {copy.preferences}
              </button>
              <button
                className="secondary-button chat-header-button"
                type="button"
                onClick={handleResetChat}
              >
                {copy.newChat}
              </button>
              <Link className="secondary-button chat-header-button" to={plannerHref}>
                {copy.planner}
              </Link>
            </div>
          </div>

          <div className="chat-window">
            {messages.map((item, index) => (
              <div className={`chat-bubble ${item.role}`} key={`${item.role}-${index}`}>
                <em>{item.role === 'assistant' ? copy.assistant : copy.user}</em>
                {item.role === 'assistant' ? (
                  <MarkdownMessage content={item.text} />
                ) : (
                  <p>{item.text}</p>
                )}
              </div>
            ))}

            {isLoading ? (
              <div className="chat-bubble assistant chat-bubble--loading">
                <em>{copy.assistant}</em>
                <div className="chat-dots" aria-label={copy.sending}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : null}

            {error ? <div className="chat-error">{error}</div> : null}
            <div ref={threadEndRef} />
          </div>

          <div className="chat-quick-panel">
            <span>{copy.quickTitle}</span>
            <div className="chat-session-list">
              {copy.quickPrompts.map((prompt) => (
                <button
                  className="chat-session-button"
                  key={prompt}
                  type="button"
                  onClick={() => void sendMessage(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {showPreferences ? (
            <section className="chat-panel chat-panel--preferences">
              <span>{copy.preferences}</span>
              <h2>{copy.preferencesBody}</h2>
              <div className="chat-filter-grid">
                <label>
                  <span>{copy.region}</span>
                  <input
                    value={preferences.region}
                    onChange={(event) =>
                      setPreferences((current) => ({ ...current, region: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>{copy.budget}</span>
                  <input
                    value={preferences.budget}
                    onChange={(event) =>
                      setPreferences((current) => ({ ...current, budget: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>{copy.theme}</span>
                  <input
                    value={preferences.theme}
                    onChange={(event) =>
                      setPreferences((current) => ({ ...current, theme: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>{copy.companion}</span>
                  <input
                    value={preferences.companion}
                    onChange={(event) =>
                      setPreferences((current) => ({ ...current, companion: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>{copy.travelDate}</span>
                  <input
                    type="date"
                    value={preferences.travelDate}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        travelDate: event.target.value,
                        season: inferSeasonFromDate(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{copy.duration}</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={preferences.duration}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        duration: Number(event.target.value) || 1,
                      }))
                    }
                  />
                </label>
              </div>
            </section>
          ) : null}

          <form className="chat-composer" onSubmit={handleSubmit}>
            <textarea
              placeholder={copy.placeholder}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
            />
            <div className="chat-composer__footer">
              <span>{copy.enterHint}</span>
              <button className="primary-button chat-send-button" type="submit" disabled={isLoading}>
                {isLoading ? copy.sending : copy.send}
              </button>
            </div>
          </form>
        </section>

        <aside className="chat-evidence">
          <section className="chat-panel">
            <span>{copy.sourceSummary}</span>
            <h2>{result?.retrieval_summary ?? copy.emptySummary}</h2>
            <p>{result?.weather.travel_verdict ?? copy.emptyWeather}</p>
          </section>

          <section className="chat-panel">
            <span>{copy.weather}</span>
            <h2>{result?.weather.headline ?? copy.emptyWeather}</h2>
            <div className="weather-card">
              <strong>{result?.weather.temperature ?? '-'}</strong>
              <p>{result?.weather.travel_verdict ?? copy.emptyWeather}</p>
              <small>{result?.weather.caution ?? '-'}</small>
            </div>
          </section>

          <section className="chat-panel">
            <span>{copy.sources}</span>
            <div className="evidence-list">
              {result?.sources.length ? (
                result.sources.map((source) => (
                  <Link className="evidence-card" key={source.post_id} to={`/posts/${source.post_id}`}>
                    <strong>{source.title}</strong>
                    <span>
                      {localizeLookupValue('region', source.region, language)} ·{' '}
                      {localizeLookupValue('theme', source.theme, language)} ·{' '}
                      {localizeLookupValue('companion', source.companion, language)}
                    </span>
                    <p>{source.matched_excerpt || source.summary}</p>
                  </Link>
                ))
              ) : (
                <div className="chat-empty-card">{copy.emptySources}</div>
              )}
            </div>
          </section>

          <section className="chat-panel">
            <span>{copy.trace}</span>
            <div className="trace-list">
              {result?.trace.length ? (
                result.trace.map((trace, index) => (
                  <div className="trace-card" key={`${trace.tool}-${index}`}>
                    <strong>{trace.tool}</strong>
                    <p>{trace.summary}</p>
                  </div>
                ))
              ) : (
                <div className="chat-empty-card">{copy.emptySummary}</div>
              )}
            </div>
          </section>

          <section className="chat-panel">
            <span>{copy.plan}</span>
            <div className="mini-plan-list">
              {result?.plan.length ? (
                result.plan.slice(0, 2).map((day) => (
                  <div className="mini-plan-card" key={day.day_label}>
                    <div className="mini-plan-card__top">
                      <strong>{day.day_label}</strong>
                      <span>{day.theme}</span>
                    </div>
                    <p>{day.stops[0]?.description}</p>
                  </div>
                ))
              ) : (
                <div className="chat-empty-card">{copy.emptyPlan}</div>
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}
