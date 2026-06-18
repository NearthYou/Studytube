import { getCurrentPathWithSearch } from './navigation'
import { toSafeRedirectPath } from './paths'

export type AuthModalMode = 'login' | 'signup'

export type AuthModalDetail = {
  mode?: AuthModalMode
  redirectPath?: string
}

export const authModalEventName = 'tail-talk:open-auth-modal'

let pendingAuthModalDetail: AuthModalDetail | null = null

export function openAuthModal({ mode = 'login', redirectPath = getCurrentPathWithSearch() }: AuthModalDetail = {}) {
  pendingAuthModalDetail = {
    mode,
    redirectPath: toSafeRedirectPath(redirectPath),
  }

  window.dispatchEvent(
    new CustomEvent<AuthModalDetail>(authModalEventName, {
      detail: pendingAuthModalDetail,
    }),
  )
}

export function consumePendingAuthModal() {
  const detail = pendingAuthModalDetail

  pendingAuthModalDetail = null
  return detail
}
