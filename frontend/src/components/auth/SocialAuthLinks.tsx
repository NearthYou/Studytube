import { getSocialAuthUrl } from '../../api/auth'
import { getEnabledSocialProviders } from '../../data/socialProviders'

type SocialAuthLinksProps = {
  mode: 'login' | 'signup'
  redirectPath?: string
}

export function SocialAuthLinks({ mode, redirectPath = '/' }: SocialAuthLinksProps) {
  const ariaLabel = mode === 'login' ? '소셜 로그인' : '소셜 회원가입'
  const providers = getEnabledSocialProviders()

  if (providers.length === 0) {
    return null
  }

  return (
    <div className="social-login-list" aria-label={ariaLabel}>
      {providers.map((provider) => (
        <a
          className={`social-login-button ${provider.id}`}
          href={getSocialAuthUrl(provider.id, redirectPath)}
          key={provider.id}
        >
          <span className="social-mark">{provider.mark}</span>
          <span>{mode === 'login' ? provider.loginLabel : provider.signupLabel}</span>
        </a>
      ))}
    </div>
  )
}
