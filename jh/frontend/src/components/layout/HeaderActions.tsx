import { LogIn, LogOut, PenLine, UserCircle, UserPlus } from 'lucide-react'
import { logout } from '../../api/auth'
import { clearAuthSession, getStoredUser } from '../../utils/authStorage'
import { openAuthModal } from '../../utils/authModal'
import { navigate } from '../../utils/navigation'
import { appPaths } from '../../utils/paths'

type HeaderActionsProps = {
  variant: 'feed' | 'board' | 'auth'
}

export function HeaderActions({ variant }: HeaderActionsProps) {
  const pathname = window.location.pathname
  const isAuthVariant = variant === 'auth'
  const shouldShowWrite = !isAuthVariant
  const isSignupPage = pathname === appPaths.signup
  const authLabel = isSignupPage ? '로그인' : '회원가입'
  const AuthIcon = isSignupPage ? LogIn : UserPlus
  const storedUser = getStoredUser()
  const currentPath = `${window.location.pathname}${window.location.search}`

  const handleLogout = async () => {
    await logout().catch(() => undefined)
    clearAuthSession()
    navigate(appPaths.home)
  }

  return (
    <div className="header-actions">
      {shouldShowWrite && storedUser && (
        <a className="ui-button ui-button--primary ui-button--pill write-button" href={appPaths.postCreate}>
          <PenLine size={17} aria-hidden="true" />
          <span>글쓰기</span>
        </a>
      )}
      {shouldShowWrite && !storedUser && (
        <button
          className="ui-button ui-button--primary ui-button--pill write-button"
          type="button"
          onClick={() => openAuthModal({ mode: 'login', redirectPath: appPaths.postCreate })}
        >
          <PenLine size={17} aria-hidden="true" />
          <span>글쓰기</span>
        </button>
      )}
      {storedUser && !isAuthVariant ? (
        <>
          <a className="user-chip" href={appPaths.myPage}>
            <UserCircle size={17} aria-hidden="true" />
            <span>{storedUser.nickname}</span>
          </a>
          <button
            className="ui-button ui-button--utility ui-button--pill login-button"
            type="button"
            onClick={handleLogout}
          >
            <LogOut size={17} aria-hidden="true" />
            <span>로그아웃</span>
          </button>
        </>
      ) : (
        <button
          className="ui-button ui-button--utility ui-button--pill login-button"
          type="button"
          onClick={() =>
            openAuthModal({
              mode: isAuthVariant && !isSignupPage ? 'signup' : 'login',
              redirectPath: currentPath,
            })
          }
        >
          <AuthIcon size={17} aria-hidden="true" />
          <span>{isAuthVariant ? authLabel : '로그인'}</span>
        </button>
      )}
    </div>
  )
}
