import { useState } from "react";
import type { FormEvent } from "react";
import { verifyMe } from "../../api";
import type { User } from "../../types";

export function ProfileVerificationForm({
  submitLabel,
  onVerified,
}: {
  submitLabel: string;
  onVerified: (user: User, currentPassword: string) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [status, setStatus] = useState("현재 비밀번호를 입력하세요.");
  const [isChecking, setIsChecking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (isChecking) {
      return;
    }

    const trimmedCurrentPassword = currentPassword.trim();

    if (!trimmedCurrentPassword) {
      setStatus("현재 비밀번호가 필요합니다.");
      return;
    }

    setIsChecking(true);
    setStatus("본인 확인 중입니다.");

    try {
      const user = await verifyMe({
        currentPassword: trimmedCurrentPassword,
      });

      setStatus("본인 확인이 완료되었습니다.");
      onVerified(user, trimmedCurrentPassword);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "본인 확인에 실패했습니다.",
      );
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <form className="profile-form profile-verification-form" onSubmit={submit}>
      <section className="profile-form-section identity-section">
        <div>
          <strong>본인 확인</strong>
          <p>내 정보 수정 화면으로 이동하기 전에 현재 비밀번호를 확인합니다.</p>
        </div>
        <label>
          현재 비밀번호
          <input
            minLength={8}
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="현재 비밀번호"
            disabled={isChecking}
          />
        </label>
        <div className="section-title compact-title">
          <span>{status}</span>
          <button
            type="submit"
            disabled={isChecking || !currentPassword.trim()}
          >
            {isChecking ? "확인 중" : submitLabel}
          </button>
        </div>
      </section>
    </form>
  );
}
