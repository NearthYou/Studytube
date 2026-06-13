import { Link, useLocation } from 'react-router'
import type { User } from '../types/community'
import type { Language } from '../utils/language'
import '../styles/components/AppShell.css'

type AppShellProps = {
  currentUser: User | null
  onSignOut: () => void
  language: Language
  onToggleLanguage: () => void
}

const COPY = {
  ko: {
    eyebrow: 'travel community',
    nav: [
      { label: '메인', path: '/main' },
      { label: '마이페이지', path: '/mypage' },
      { label: '글쓰기', path: '/write' },
      { label: '채팅', path: '/chat' },
      { label: '플래너', path: '/planner' },
    ],
    sectionTitles: {
      '/main': '여행 게시판',
      '/mypage': '내 여행 보드',
      '/write': '새 글 작성',
      '/chat': 'AI 여행 채팅',
      '/planner': 'AI 일정 플래너',
    },
    tripDesk: '내 여행 공간',
    signOut: '로그아웃',
    toggle: 'EN',
  },
  en: {
    eyebrow: 'travel community',
    nav: [
      { label: 'Home', path: '/main' },
      { label: 'My Page', path: '/mypage' },
      { label: 'Write', path: '/write' },
      { label: 'Chat', path: '/chat' },
      { label: 'Planner', path: '/planner' },
    ],
    sectionTitles: {
      '/main': 'Travel board',
      '/mypage': 'My travel desk',
      '/write': 'Create a post',
      '/chat': 'AI travel chat',
      '/planner': 'AI trip planner',
    },
    tripDesk: 'Your space',
    signOut: 'Sign out',
    toggle: 'KO',
  },
} satisfies Record<
  Language,
  {
    eyebrow: string
    nav: { label: string; path: string }[]
    sectionTitles: Record<string, string>
    tripDesk: string
    signOut: string
    toggle: string
  }
>

function resolveSectionTitle(pathname: string, titles: Record<string, string>) {
  const matched = Object.keys(titles).find((path) => pathname.startsWith(path))
  return matched ? titles[matched] : titles['/main']
}

export function AppShell({ currentUser, onSignOut, language, onToggleLanguage }: AppShellProps) {
  const location = useLocation()
  const copy = COPY[language]

  if (!currentUser || location.pathname === '/login' || location.pathname === '/signup') {
    return null
  }

  const currentSectionTitle = resolveSectionTitle(location.pathname, copy.sectionTitles)

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="site-header__left">
          <Link aria-label="Tripy" className="site-header__brand" to="/main">
            <img alt="Tripy" className="site-header__brand-mark" src="/tripy-logo.png" />
          </Link>
          <div className="site-header__context">
            <span className="site-header__eyebrow">{copy.eyebrow}</span>
            <strong className="site-header__section">{currentSectionTitle}</strong>
          </div>
        </div>

        <nav aria-label="Primary" className="site-header__nav">
          {copy.nav.map((item) => (
            <Link
              className={`site-header__nav-link ${location.pathname === item.path ? 'active' : ''} ${item.path === '/write' ? 'site-header__nav-link--primary' : ''}`}
              key={item.path}
              to={item.path}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="site-header__right">
          <Link className="site-header__profile" to="/mypage">
            <span>{copy.tripDesk}</span>
            <strong>{currentUser.nickname}</strong>
          </Link>
          <button className="site-header__language" type="button" onClick={onToggleLanguage}>
            {copy.toggle}
          </button>
          <button className="ghost-button" type="button" onClick={onSignOut}>
            {copy.signOut}
          </button>
        </div>
      </div>
    </header>
  )
}
