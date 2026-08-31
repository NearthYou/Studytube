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
  const [status, setStatus] = useState("");
  const [isChecking, setIsChecking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (isChecking) {
      return;
    }

    const trimmedCurrentPassword = currentPassword.trim();

    if (!trimmedCurrentPassword) {
      setStatus("현재 비밀번호를 입력해 주세요.");
      return;
    }

    setIsChecking(true);
    setStatus("확인하고 있어요.");

    try {
      const user = await verifyMe({
        currentPassword: trimmedCurrentPassword,
      });

      setStatus("확인했어요.");
      onVerified(user, trimmedCurrentPassword);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "비밀번호를 확인하지 못했어요.",
      );
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <form className="profile-form profile-verification-form" onSubmit={submit}>
      <section className="profile-form-section identity-section">
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
          <span aria-live="polite">{status}</span>
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
