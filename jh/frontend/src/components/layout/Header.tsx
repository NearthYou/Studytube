import tailTalkLogo from '../../assets/tail_talk_logo.png'
import { appPaths } from '../../utils/paths'
import { HeaderActions } from './HeaderActions'
import { HeaderSearch } from './HeaderSearch'

type HeaderProps = {
  variant?: 'feed' | 'board' | 'auth'
}

export function Header({ variant = 'feed' }: HeaderProps) {
  const shouldShowSearch = variant === 'feed'

  return (
    <header className={`app-header app-header--${variant}`}>
      <a className="brand" href={appPaths.home} aria-label="Tail Talk 홈">
        <img className="brand-logo" src={tailTalkLogo} alt="" />
        <span className="brand-name">Tail Talk</span>
      </a>

      {shouldShowSearch && <HeaderSearch />}

      <HeaderActions variant={variant} />
    </header>
  )
}
