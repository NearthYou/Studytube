import type { TravelAgentRequest } from './aiAPI'

export type SeasonCode = 'spring' | 'summer' | 'fall' | 'winter'

export function inferSeasonCodeFromDate(travelDate: string): SeasonCode | '' {
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

export function createTravelAgentSearchParams(request: TravelAgentRequest) {
  return new URLSearchParams({
    q: request.query,
    region: request.region,
    budget: request.budget,
    theme: request.theme,
    season: request.season,
    companion: request.companion,
    travelDate: request.travelDate,
    duration: String(request.duration),
  })
}
