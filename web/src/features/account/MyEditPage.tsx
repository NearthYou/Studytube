import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { fetchMe, updateMe } from "../../api";
import { isProfileEditVerificationFresh, profileEditDraftFromUser } from "../../profileEdit";
import type { Session, User } from "../../types";
import { ProfileVerificationForm } from "./ProfileVerificationForm";

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
  const [user, setUser] = useState(session.user);
  const [draft, setDraft] = useState(() =>
    profileEditDraftFromUser(session.user),
  );
  const [status, setStatus] = useState("수정할 정보를 불러오는 중입니다.");
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

        setUser(nextUser);
        setDraft(profileEditDraftFromUser(nextUser));
        onSessionUpdate(nextUser);
        setStatus("본인 확인 후 정보를 수정할 수 있습니다.");
      } catch {
        if (mounted) {
          setStatus("수정할 정보를 불러오지 못했습니다.");
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
      setStatus("본인 확인 시간이 만료되었습니다. 다시 확인해주세요.");
      return;
    }

    const trimmedName = draft.name.trim();
    const trimmedPassword = draft.password.trim();
    if (!trimmedName) {
      setStatus("이름을 입력하세요.");
      return;
    }

    setIsSaving(true);
    setStatus("내 정보를 저장하는 중입니다.");

    try {
      const nextUser = await updateMe({
        currentPassword: verifiedPassword,
        name: trimmedName,
        password: trimmedPassword || undefined,
      });

      setUser(nextUser);
      setDraft(profileEditDraftFromUser(nextUser));
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
      <main className="page-shell profile-page">
        <section className="profile-hero">
          <div>
            <h1>본인 확인</h1>
            <p>
              내 정보를 수정하려면 먼저 현재 비밀번호로 본인 확인을 진행합니다.
            </p>
          </div>
          <div className="profile-stats" aria-label="내 학습 데이터">
            <span>
              <strong>{user.preferences.interests.length}</strong>
              관심사
            </span>
            <span>
              <strong>5분</strong>
              확인 유지
            </span>
          </div>
        </section>
        <ProfileVerificationForm
          submitLabel="수정 페이지 열기"
          onVerified={(nextUser, currentPassword) => {
            setUser(nextUser);
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
    <main className="page-shell profile-page">
      <section className="profile-hero">
        <div>
          <h1>내 정보 수정</h1>
          <p>
            본인 확인이 완료되었습니다. 이름이나 비밀번호를 변경할 수 있습니다.
          </p>
        </div>
        <div className="profile-stats" aria-label="수정 상태">
          <span>
            <strong>{user.preferences.interests.length}</strong>
            관심사
          </span>
          <span>
            <strong>확인됨</strong>
            본인 확인
          </span>
        </div>
      </section>

      <form className="profile-form" onSubmit={submit}>
        <div className="section-title">
          <h2>계정 설정</h2>
          <span>{status}</span>
        </div>
        <section className="profile-form-section">
          <div>
            <strong>계정 정보</strong>
            <p>서비스 안에서 표시될 이름과 로그인 비밀번호를 관리합니다.</p>
          </div>
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

        <div className="row-actions">
          <button type="submit" disabled={isSaving}>
            {isSaving ? "저장 중" : "변경 저장"}
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
