import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { login, resendEmailVerification, signUp } from "../../api";
import {
  authCompletionDestination,
  signupTutorialNextDestination,
  tutorialNextDestination,
  type AuthMode,
} from "../../onboarding";
import {
  acceptedRegistrationEmail,
  registrationEmailRequest,
  type RegistrationEmailStage,
} from "../../registrationEmailFlow";
import type { Session } from "../../types";

export function AuthPage({
  mode,
  onComplete,
}: {
  mode: AuthMode;
  onComplete: (session: Session) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [status, setStatus] = useState(
    mode === "login"
      ? "계정으로 로그인하면 모든 학습 서비스가 열립니다."
      : "이메일을 입력하면 가입을 계속할 인증 링크를 보내드립니다.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const [registrationEmailStage, setRegistrationEmailStage] =
    useState<RegistrationEmailStage>({ kind: "initial" });
  const resendRequested =
    mode === "signup" &&
    typeof location.state === "object" &&
    location.state !== null &&
    "resend" in location.state &&
    location.state.resend === true;
  const isRegistrationResend =
    mode === "signup" &&
    (resendRequested || registrationEmailStage.kind === "sent");
  const from =
    typeof location.state === "object" &&
    location.state &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setIsSubmitting(true);

    try {
      if (mode === "signup") {
        const delivery = registrationEmailRequest(
          registrationEmailStage,
          form.email,
          resendRequested,
        );
        if (delivery.action === "resend") {
          await resendEmailVerification({ email: delivery.email });
        } else {
          await signUp({ email: delivery.email });
        }
        setRegistrationEmailStage(acceptedRegistrationEmail(delivery.email));
        setForm((current) => ({ ...current, email: delivery.email }));
        setStatus(
          "인증 메일을 보냈습니다. 메일의 링크를 열어 가입을 계속해주세요.",
        );
        return;
      }

      const nextSession = await login({
        email: form.email,
        password: form.password,
      });
      completeAuth(nextSession);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "인증에 실패했어요. 이메일과 비밀번호를 확인하세요.",
      );
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  function completeAuth(nextSession: Session) {
    const destination = authCompletionDestination({ mode, from });
    const nextAfterTutorial =
      typeof location.state === "object" &&
      location.state &&
      "next" in location.state &&
      typeof location.state.next === "string"
        ? tutorialNextDestination(location.state.next)
        : undefined;

    onComplete(nextSession);
    navigate(destination, {
      replace: true,
      state:
        mode === "signup"
          ? { next: signupTutorialNextDestination(from) }
          : destination === "/tutorial" && nextAfterTutorial
            ? { next: nextAfterTutorial }
            : undefined,
    });
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">StudyTube Account</p>
        <h1>{mode === "login" ? "로그인" : "회원가입"}</h1>
        <p>{status}</p>
        <form className="stack-form" onSubmit={submit}>
          <input
            value={form.email}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
            placeholder="이메일"
            type="email"
            disabled={
              isSubmitting ||
              (mode === "signup" && registrationEmailStage.kind === "sent")
            }
            required
          />
          {mode === "login" && (
            <input
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
              placeholder="비밀번호"
              type="password"
              disabled={isSubmitting}
              required
            />
          )}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "처리 중"
              : mode === "signup"
                ? isRegistrationResend
                  ? "인증 메일 다시 받기"
                  : "인증 메일 받기"
                : "로그인"}
          </button>
        </form>
        <div className="auth-switch">
          {mode === "login" ? (
            <Link to="/signup">계정 만들기</Link>
          ) : (
            <Link to="/login">로그인으로 돌아가기</Link>
          )}
        </div>
      </section>
    </main>
  );
}
