import { useLocation, useSearchParams } from "react-router";
import { googleLoginUrl } from "../../api";
import {
  accountDeletedMessage,
  googleAuthErrorMessage,
  safeGoogleReturnPath,
} from "./googleAuthPresentation";

export function AuthPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = location.state as { from?: unknown } | null;
  const returnPath = safeGoogleReturnPath(state?.from);
  const statusMessage =
    googleAuthErrorMessage(searchParams.get("googleError")) ||
    accountDeletedMessage(searchParams.get("accountDeleted"));

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>영상으로 배우기</h1>
        <p>Google 계정으로 바로 시작하세요.</p>
        {statusMessage && (
          <p className="auth-status" aria-live="polite">
            {statusMessage}
          </p>
        )}
        <a
          className="primary-link google-login"
          href={googleLoginUrl(returnPath)}
        >
          Google로 계속하기
        </a>
      </section>
    </main>
  );
}
