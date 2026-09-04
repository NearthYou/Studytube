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
    <main className="auth-page auth-landing">
      <section className="auth-landing-shell">
        <div className="auth-card auth-landing-copy">
          <div>
            <h1>유튜브를 보다가 놓친 문장, 바로 이해하세요</h1>
            <p>
              원문과 번역을 함께 보고, 기억할 문장은 저장해 다시 볼 수
              있어요.
            </p>
          </div>
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
          <ul className="auth-outcomes">
            <li>
              <strong>원문과 번역</strong>
              <span>같은 장면에서 함께 봐요.</span>
            </li>
            <li>
              <strong>장면에 남기는 메모</strong>
              <span>저장한 시간으로 다시 돌아가요.</span>
            </li>
            <li>
              <strong>최근 학습</strong>
              <span>보던 영상부터 이어서 봐요.</span>
            </li>
          </ul>
        </div>

        <aside className="auth-product-preview" aria-label="학습 화면 미리보기">
          <div className="auth-preview-video" aria-hidden="true">
            <div className="auth-preview-video-top">
              <span />
              <span>07:12</span>
            </div>
            <div className="auth-preview-play" />
            <div className="auth-preview-caption">
              <p>Small steps make difficult things easier.</p>
              <p>작게 나누면 어려운 일도 한결 쉬워집니다.</p>
            </div>
          </div>
          <div className="auth-preview-tabs" aria-hidden="true">
            <strong>지금 문장</strong>
            <span>내용 정리</span>
            <span>내 메모</span>
          </div>
          <div className="auth-preview-saved" aria-hidden="true">
            <small>저장한 문장</small>
            <strong>Small steps make difficult things easier.</strong>
            <span>07:12</span>
          </div>
        </aside>
      </section>
    </main>
  );
}
