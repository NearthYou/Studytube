import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { fetchMe, updateMe } from "../../api";
import { isProfileEditVerificationFresh, profileEditDraftFromUser } from "../../profileEdit";
import type { Session, User } from "../../types";
import { ProfileVerificationForm } from "./ProfileVerificationForm";
import "./AccountEditPage.css";

export function MyEditPage({
  session,
  onSessionUpdate,
}: {
  session: Session;
  onSessionUpdate: (user: User) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const verificationState = (location.state ?? {}) as {
    currentPassword?: string;
    verifiedAt?: number;
  };
  const verifiedAt =
    typeof verificationState.verifiedAt === "number"
      ? verificationState.verifiedAt
      : null;
  const verifiedPassword =
    typeof verificationState.currentPassword === "string"
      ? verificationState.currentPassword
      : "";
  const [draft, setDraft] = useState(() =>
    profileEditDraftFromUser(session.user),
  );
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const verified = isProfileEditVerificationFresh(verifiedAt);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        const nextUser = await fetchMe();

        if (!mounted) {
          return;
        }

        setDraft(profileEditDraftFromUser(nextUser));
        onSessionUpdate(nextUser);
      } catch {
        if (mounted) {
          setStatus("내 정보를 불러오지 못했어요.");
        }
      }
    }

    void loadProfile();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    if (!isProfileEditVerificationFresh(verifiedAt) || !verifiedPassword) {
      setStatus("확인 시간이 지났어요. 현재 비밀번호를 다시 확인해 주세요.");
      return;
    }

    const trimmedName = draft.name.trim();
    const trimmedPassword = draft.password.trim();
    if (!trimmedName) {
      setStatus("이름을 입력하세요.");
      return;
    }

    setIsSaving(true);
    setStatus("저장하고 있어요.");

    try {
      const nextUser = await updateMe({
        currentPassword: verifiedPassword,
        name: trimmedName,
        password: trimmedPassword || undefined,
      });

      onSessionUpdate(nextUser);
      navigate("/me", { replace: true });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "내 정보를 저장하지 못했어요.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!verified) {
    return (
      <main className="page-shell profile-page account-edit-page">
        <header className="account-edit-heading">
          <h1>내 정보 수정</h1>
          <p>현재 비밀번호를 확인해 주세요.</p>
        </header>
        <ProfileVerificationForm
          submitLabel="확인"
          onVerified={(nextUser, currentPassword) => {
            onSessionUpdate(nextUser);
            navigate("/me/edit", {
              replace: true,
              state: {
                currentPassword,
                verifiedAt: Date.now(),
              },
            });
          }}
        />
      </main>
    );
  }

  return (
    <main className="page-shell profile-page account-edit-page">
      <header className="account-edit-heading">
        <h1>내 정보 수정</h1>
      </header>

      <form className="account-edit-form" onSubmit={submit}>
        <section className="account-edit-fields">
          <label>
            이름
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="표시할 이름"
              disabled={isSaving}
            />
          </label>
          <label>
            이메일
            <input value={draft.email} readOnly />
          </label>
          <label>
            새 비밀번호
            <input
              minLength={8}
              type="password"
              value={draft.password}
              onChange={(event) =>
                setDraft({ ...draft, password: event.target.value })
              }
              placeholder="변경할 때만 입력"
              disabled={isSaving}
            />
          </label>
        </section>

        <p className="account-edit-status" aria-live="polite">
          {status}
        </p>
        <div className="account-edit-actions">
          <button type="submit" disabled={isSaving}>
            {isSaving ? "저장 중" : "저장"}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={isSaving}
            onClick={() => navigate("/me")}
          >
            취소
          </button>
        </div>
      </form>
    </main>
  );
}
