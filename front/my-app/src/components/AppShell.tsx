import { Link, useLocation, useNavigate } from 'react-router'
import type { User } from '../types/community'
import '../styles/components/AppShell.css'

type AppShellProps = {
  currentUser: User | null
  onSignOut: () => void
}

export function AppShell({ currentUser, onSignOut }: AppShellProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const navItems = [
    { label: 'MAIN', path: '/main' },
    { label: 'MY PAGE', path: '/mypage' },
    { label: 'WRITE', path: '/write' },
    { label: 'CHAT BOT', path: '/chat' },
    { label: 'PLANNER', path: '/planner' },
  ]

  if (!currentUser || location.pathname === '/login' || location.pathname === '/signup') {
    return null
  }

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="site-header__left">
          <span className="site-header__eyebrow">Cozy Trip Community</span>
          <Link aria-label="Tripy home" className="site-header__brand" to="/main">
            <img alt="Tripy" className="site-header__brand-mark" src="/tripy-logo.png" />
          </Link>
        </div>
        <nav className="site-header__nav">
          {navItems.map((item) => (
            <button
              className={location.pathname === item.path ? 'active' : ''}
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="site-header__right">
          <span>{currentUser.nickname}</span>
          <button className="ghost-button" type="button" onClick={onSignOut}>
            LOGOUT
          </button>
        </div>
      </div>
    </header>
  )
}
