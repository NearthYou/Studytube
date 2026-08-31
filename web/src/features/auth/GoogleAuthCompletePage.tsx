import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { fetchMe } from "../../api";
import type { Session } from "../../types";
import { safeGoogleReturnPath } from "./googleAuthPresentation";

export function GoogleAuthCompletePage({
  onComplete,
}: {
  onComplete: (session: Session) => void;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("로그인을 확인하고 있어요.");
  const onCompleteRef = useRef(onComplete);
  const returnPath = safeGoogleReturnPath(searchParams.get("returnTo"));

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let active = true;

    async function complete() {
      try {
        const user = await fetchMe();
        if (!active) return;
        onCompleteRef.current({ user });
        navigate(returnPath, { replace: true });
      } catch {
        if (active) setStatus("로그인을 마치지 못했어요. 다시 시작해 주세요.");
      }
    }

    void complete();
    return () => {
      active = false;
    };
  }, [navigate, returnPath]);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>로그인</h1>
        <p className="auth-status" aria-live="polite">
          {status}
        </p>
        {status.includes("마치지 못했어요") && (
          <Link className="primary-link" replace to="/login">
            다시 로그인
          </Link>
        )}
      </section>
    </main>
  );
}
