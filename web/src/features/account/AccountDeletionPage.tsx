import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { accountDeletionReauthUrl, deleteMe } from "../../api";
import "./AccountDeletionPage.css";

export function AccountDeletionPage({ onDeleted }: { onDeleted: () => void }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [confirmed, setConfirmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [status, setStatus] = useState(() =>
    deletionErrorMessage(searchParams.get("googleError")),
  );
  const verified = searchParams.get("verified") === "1";

  async function removeAccount() {
    if (!verified || !confirmed || isDeleting) return;
    setIsDeleting(true);
    setStatus("삭제하고 있어요.");
    try {
      await deleteMe();
      onDeleted();
      navigate("/login?accountDeleted=1", { replace: true });
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "계정을 삭제하지 못했어요. 다시 시도해 주세요.",
      );
      setIsDeleting(false);
    }
  }

  return (
    <main className="page-shell account-deletion-page">
      <section className="account-deletion-card">
        <h1>회원 탈퇴</h1>
        <p>계정과 학습 기록이 모두 삭제되며 복구할 수 없어요.</p>

        {!verified && (
          <a
            className="primary-link account-reauth-link"
            href={accountDeletionReauthUrl()}
          >
            Google로 본인 확인
          </a>
        )}

        <label className="account-deletion-confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!verified || isDeleting}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          삭제하면 되돌릴 수 없음을 확인했습니다.
        </label>

        <p className="account-deletion-status" aria-live="polite">
          {verified && !status ? "본인 확인을 마쳤어요." : status}
        </p>

        <div className="account-deletion-actions">
          <button
            className="danger-action"
            type="button"
            disabled={!verified || !confirmed || isDeleting}
            onClick={() => void removeAccount()}
          >
            {isDeleting ? "삭제 중" : "계정과 학습 기록 삭제"}
          </button>
          <Link className="secondary-link" to="/me">
            취소
          </Link>
        </div>
      </section>
    </main>
  );
}

function deletionErrorMessage(code: string | null) {
  if (code === "wrong_account") {
    return "현재 계정과 같은 Google 계정으로 확인해 주세요.";
  }
  if (code === "unavailable") {
    return "지금은 본인 확인을 할 수 없어요. 잠시 후 다시 시도해 주세요.";
  }
  return "";
}
