import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { fetchMe, updateMe } from "../../api";
import { profileEditDraftFromUser } from "../../profileEdit";
import type { Session, User } from "../../types";
import "./AccountEditPage.css";

export function MyEditPage({
  session,
  onSessionUpdate,
}: {
  session: Session;
  onSessionUpdate: (user: User) => void;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() =>
    profileEditDraftFromUser(session.user),
  );
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const user = await fetchMe();
        if (!active) return;
        setDraft(profileEditDraftFromUser(user));
        onSessionUpdate(user);
      } catch {
        if (active) setStatus("내 정보를 불러오지 못했어요.");
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
    // Session identity is the load boundary. onSessionUpdate is intentionally
    // read through the current render to avoid reloading after its state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;
    const name = draft.name.trim();
    if (!name) {
      setStatus("이름을 입력해 주세요.");
      return;
    }

    setIsSaving(true);
    setStatus("저장하고 있어요.");
    try {
      const user = await updateMe({ name });
      onSessionUpdate(user);
      navigate("/me", { replace: true });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "내 정보를 저장하지 못했어요.",
      );
    } finally {
      setIsSaving(false);
    }
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
              maxLength={100}
              required
            />
          </label>
          <label>
            이메일
            <input value={draft.email} readOnly />
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
