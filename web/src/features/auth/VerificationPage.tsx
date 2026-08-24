import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { consumeEmailVerification } from "../../api";
import { consumeVerificationFragment } from "../../verificationFlow";

export function VerificationPage() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [status, setStatus] = useState("인증 링크를 확인하고 있습니다.");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void consumeVerificationFragment(
      window.location,
      window.history,
      consumeEmailVerification,
    )
      .then(() => navigate("/signup/complete", { replace: true }))
      .catch(() => {
        setStatus(
          "인증 링크가 올바르지 않거나 만료되었습니다. 새 인증 메일을 요청해주세요.",
        );
      });
  }, [navigate]);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">StudyTube 계정</p>
        <h1>이메일 인증</h1>
        <p>{status}</p>
        <div className="auth-switch">
          <Link to="/signup" state={{ resend: true }}>
            인증 메일 다시 받기
          </Link>
        </div>
      </section>
    </main>
  );
}
