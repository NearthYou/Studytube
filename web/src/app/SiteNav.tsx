import type { Session } from "../types";
import { GuardedLink, GuardedNavLink } from "./GuardedLink";
import { useLocation } from "react-router";

export function SiteNav({
  session,
  onLogout,
}: {
  session: Session | null;
  onLogout: () => void;
}) {
  const location = useLocation();

  return (
    <header className="site-nav">
      <GuardedLink className="brand" to="/" aria-label="StudyTube home">
        StudyTube
      </GuardedLink>
      {session ? (
        <>
          <nav>
            <GuardedNavLink to="/watch">학습</GuardedNavLink>
            <GuardedNavLink to="/courses">내 코스</GuardedNavLink>
            <GuardedNavLink to="/me">내 정보</GuardedNavLink>
          </nav>
          <div className="nav-account">
            <GuardedLink to="/me">{session.user.name}</GuardedLink>
            <button type="button" onClick={onLogout}>
              로그아웃
            </button>
          </div>
        </>
      ) : location.pathname !== "/login" ? (
        <div className="nav-account">
          <GuardedLink className="nav-cta" to="/login">
            로그인
          </GuardedLink>
        </div>
      ) : null}
    </header>
  );
}
