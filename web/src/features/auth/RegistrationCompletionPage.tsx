import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  completeRegistration,
  fetchRegistrationReadiness,
} from "../../api";
import { signupTutorialNextDestination } from "../../onboarding";
import type { Session } from "../../types";

export function RegistrationCompletionPage({
  onComplete,
}: {
  onComplete: (session: Session) => void;
}) {
  const navigate = useNavigate();
  const [readiness, setReadiness] = useState<"checking" | "ready" | "invalid">(
    "checking",
  );
  const [form, setForm] = useState({ name: "", password: "" });
  const [status, setStatus] = useState("안전한 가입 세션을 확인하고 있습니다.");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchRegistrationReadiness()
      .then(() => {
        if (active) {
          setReadiness("ready");
          setStatus("이름과 비밀번호를 정하면 가입이 완료됩니다.");
        }
      })
      .catch(() => {
        if (active) {
          setReadiness("invalid");
          setStatus(
            "가입 세션이 없거나 만료되었습니다. 이메일 인증부터 다시 시작해주세요.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readiness !== "ready" || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const session = await completeRegistration(form);
      onComplete(session);
      navigate("/tutorial", {
        replace: true,
        state: { next: signupTutorialNextDestination("/") },
      });
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "가입을 완료하지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">StudyTube Account</p>
        <h1>가입 완료</h1>
        <p>{status}</p>
        {readiness === "ready" && (
          <form className="stack-form" onSubmit={submit}>
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="이름"
              autoComplete="name"
              disabled={isSubmitting}
              required
            />
            <input
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
              placeholder="비밀번호"
              type="password"
              autoComplete="new-password"
              aria-describedby="registration-password-hint"
              disabled={isSubmitting}
              required
            />
            <small id="registration-password-hint">
              비밀번호는 8~128바이트로 입력해주세요. 영문과 숫자는 8자
              이상입니다.
            </small>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "처리 중" : "가입 완료"}
            </button>
          </form>
        )}
        {readiness === "invalid" && (
          <div className="auth-switch">
            <Link to="/signup">이메일 인증 다시 시작하기</Link>
          </div>
        )}
      </section>
    </main>
  );
}
