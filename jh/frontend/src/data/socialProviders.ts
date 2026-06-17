export type SocialProviderId = 'naver' | 'kakao' | 'google'

export const socialProviders: Array<{
  id: SocialProviderId
  loginLabel: string
  signupLabel: string
  mark: string
}> = [
  {
    id: 'naver',
    loginLabel: '네이버',
    signupLabel: '네이버',
    mark: 'N',
  },
  {
    id: 'kakao',
    loginLabel: '카카오톡',
    signupLabel: '카카오톡',
    mark: 'K',
  },
  {
    id: 'google',
    loginLabel: '구글',
    signupLabel: '구글',
    mark: 'G',
  },
]

const socialProviderIds = new Set<SocialProviderId>(socialProviders.map((provider) => provider.id))

export function getEnabledSocialProviders() {
  const rawProviderIds = String(import.meta.env.VITE_ENABLED_SOCIAL_PROVIDERS ?? '')
  const enabledProviderIds = rawProviderIds
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is SocialProviderId => socialProviderIds.has(provider as SocialProviderId))

  if (enabledProviderIds.length === 0) {
    return []
  }

  return socialProviders.filter((provider) => enabledProviderIds.includes(provider.id))
}
