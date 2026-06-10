import type { PostWithMeta } from '../types/community'

export type AssistantRequest = {
  query: string
  region: string
  budget: string
  theme: string
  season: string
  companion: string
  travelDate: string
  duration: number
}

export type WeatherInsight = {
  headline: string
  temperature: string
  travelVerdict: string
  caution: string
}

export type PlanStop = {
  time: string
  title: string
  description: string
  estimatedCost: string
}

export type PlanDay = {
  dayLabel: string
  theme: string
  stops: PlanStop[]
}

function includesKeyword(base: string, query: string) {
  return base.toLowerCase().includes(query.toLowerCase())
}

function extractKeywords(query: string) {
  return query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
}

export function inferSeasonFromDate(travelDate: string) {
  if (!travelDate) {
    return ''
  }

  const month = new Date(travelDate).getMonth() + 1
  if ([3, 4, 5].includes(month)) {
    return '봄'
  }
  if ([6, 7, 8].includes(month)) {
    return '여름'
  }
  if ([9, 10, 11].includes(month)) {
    return '가을'
  }
  return '겨울'
}

export function retrieveRelevantPosts(posts: PostWithMeta[], request: AssistantRequest, limit = 4) {
  const keywords = extractKeywords(request.query)

  return [...posts]
    .map((post) => {
      let score = 0
      const joined = `${post.title} ${post.summary} ${post.content} ${post.region} ${post.theme} ${post.companion} ${post.tags.join(' ')}`

      if (request.region && post.region === request.region) {
        score += 5
      }
      if (request.budget && post.budget === request.budget) {
        score += 3
      }
      if (request.theme && post.theme === request.theme) {
        score += 4
      }
      if (request.season && post.season === request.season) {
        score += 3
      }
      if (request.companion && post.companion === request.companion) {
        score += 4
      }
      for (const keyword of keywords) {
        if (includesKeyword(joined, keyword)) {
          score += 2
        }
      }

      if (!request.query && !request.region && !request.theme) {
        score += 1
      }

      return { post, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.post.views - left.post.views
    })
    .slice(0, limit)
    .map((entry) => entry.post)
}

export function buildWeatherInsight(request: AssistantRequest): WeatherInsight {
  const season = request.season || inferSeasonFromDate(request.travelDate)
  const region = request.region || '추천 지역'
  const duration = request.duration || 2

  if (season === '여름') {
    return {
      headline: `${region} ${duration}일 여행은 오전/저녁 중심 일정이 유리합니다.`,
      temperature: '평균 24~30도, 자외선 강함',
      travelVerdict: '바다 산책이나 카페 위주 일정에는 적합한 시기입니다.',
      caution: '한낮 실외 일정은 줄이고, 비 예보가 있으면 실내 대체 코스를 준비하는 편이 좋습니다.',
    }
  }

  if (season === '겨울') {
    return {
      headline: `${region} 겨울 여행은 바람과 체감온도를 꼭 확인해야 합니다.`,
      temperature: '평균 -2~8도, 해안 지역은 바람 강함',
      travelVerdict: '숙소 중심 여행이나 실내 명소를 섞으면 만족도가 높습니다.',
      caution: '야외 일정 비중이 높다면 방한 준비와 일몰 이후 이동 시간을 줄이는 편이 좋습니다.',
    }
  }

  if (season === '가을') {
    return {
      headline: `${region} 가을 여행은 도보 이동이 많은 일정과 잘 맞습니다.`,
      temperature: '평균 12~22도, 비교적 쾌적',
      travelVerdict: '산책, 야경, 사진 위주 여행에 가장 무난한 시기입니다.',
      caution: '주말 인기 지역은 일교차와 혼잡도를 함께 고려하는 편이 좋습니다.',
    }
  }

  return {
    headline: `${region} 봄 여행은 꽃 시즌과 주말 혼잡도를 같이 봐야 합니다.`,
    temperature: '평균 10~20도, 바람은 약간 차가울 수 있음',
    travelVerdict: '야외 산책, 브런치, 드라이브 코스와 잘 맞습니다.',
    caution: '벚꽃 시즌이나 연휴 기간에는 숙소와 이동 시간을 미리 확보하는 편이 좋습니다.',
  }
}

export function buildAgentPlan(request: AssistantRequest, posts: PostWithMeta[]) {
  const duration = Math.max(1, Math.min(request.duration || 2, 5))
  const region = request.region || posts[0]?.region || '추천 지역'
  const theme = request.theme || posts[0]?.theme || '맞춤 여행'
  const sourceTitles = posts.map((post) => post.title)

  return Array.from({ length: duration }, (_, index) => {
    const sourcePost = posts[index % Math.max(posts.length, 1)]
    const focusTitle = sourcePost?.title ?? `${region} 핵심 코스`

    return {
      dayLabel: `DAY ${index + 1}`,
      theme: index === 0 ? `${region} 도착 및 핵심 동선` : `${theme} 중심 일정`,
      stops: [
        {
          time: '09:30',
          title: `${region} 대표 장소 탐색`,
          description: sourceTitles.length
            ? `RAG로 찾은 "${focusTitle}"의 동선을 참고해 오전 코스를 시작합니다.`
            : `${region}의 대표 장소부터 가볍게 둘러보는 일정입니다.`,
          estimatedCost: request.budget || '예산 조정 가능',
        },
        {
          time: '13:00',
          title: `${theme} 중심 점심 및 휴식`,
          description: `${request.companion || '동행'} 여행 기준으로 이동 피로가 적은 식사/카페 동선을 배치합니다.`,
          estimatedCost: '1~3만원',
        },
        {
          time: '17:30',
          title: `${region} 저녁 하이라이트`,
          description: '날씨와 시간대를 고려해 야경, 산책, 오션뷰, 실내 대체 코스 중 하나를 배치합니다.',
          estimatedCost: '0~5만원',
        },
      ],
    }
  })
}
