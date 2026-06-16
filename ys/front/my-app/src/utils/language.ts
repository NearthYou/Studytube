export type Language = 'ko' | 'en'

export function getInitialLanguage(): Language {
  if (typeof window === 'undefined') {
    return 'ko'
  }

  const saved = window.localStorage.getItem('tripy-language')
  if (saved === 'ko' || saved === 'en') {
    return saved
  }

  return window.navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}
