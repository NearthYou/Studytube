import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { fetchMe } from "../../api";
import { fetchOwnerCourses } from "../../courseApi";
import type { Session, User } from "../../types";
import { ProfileVerificationForm } from "./ProfileVerificationForm";

export function MyPage({
  session,
  onSessionUpdate,
}: {
  session: Session;
  onSessionUpdate: (user: User) => void;
}) {
  const navigate = useNavigate();
  const [user, setUser] = useState(session.user);
  const [courseCount, setCourseCount] = useState(0);
  const [videoCount, setVideoCount] = useState(0);
  const [savedSentenceCount] = useState(() =>
    countSavedSentences(session.user.id),
  );
  const [status, setStatus] = useState("계정 정보를 불러오는 중입니다.");
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        const nextUser = await fetchMe();

        if (!mounted) {
          return;
        }

        setUser(nextUser);
        onSessionUpdate(nextUser);
        setStatus("학습 설정이 최신 상태입니다.");
        const nextCourses = await fetchOwnerCourses().catch(() => []);
        if (!mounted) return;
        const activeCourses = nextCourses.filter(
          (course) => course.status !== "archived",
        );
        setCourseCount(activeCourses.length);
        setVideoCount(
          activeCourses.reduce((total, course) => total + course.steps.length, 0),
        );
      } catch {
        if (mounted) {
          setStatus("학습 설정을 불러오지 못했습니다. 다시 시도해주세요.");
        }
      }
    }

    void loadProfile();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  return (
    <main className="page-shell profile-page">
      <section className="profile-hero">
        <div>
          <h1>내 학습</h1>
          <p>
            이어갈 코스와 저장한 문장을 한곳에서 확인하세요.
          </p>
          <div className="profile-actions">
            <Link className="primary-link" to="/">
              이어서 학습
            </Link>
            <button
              className="secondary-action"
              type="button"
              onClick={() => setIsVerifying((current) => !current)}
            >
              학습 설정 바꾸기
            </button>
          </div>
        </div>
        <div className="profile-stats" aria-label="내 학습 데이터">
          <span>
            <strong>{courseCount}</strong>
            진행 중인 코스
          </span>
          <span>
            <strong>{videoCount}</strong>
            학습할 영상
          </span>
          <span>
            <strong>{savedSentenceCount}</strong>
            저장한 문장
          </span>
        </div>
      </section>

      <section className="profile-layout">
        <section className="profile-read-panel">
          <div className="section-title">
            <h2>학습 설정</h2>
            <span>{status}</span>
          </div>
          <dl className="profile-info-list">
            <div>
              <dt>관심사</dt>
              <dd>{user.preferences.interests.join(", ") || "아직 정하지 않았어요"}</dd>
            </div>
            <div>
              <dt>학습 속도</dt>
              <dd>{user.preferences.pace || "아직 정하지 않았어요"}</dd>
            </div>
            <div>
              <dt>학습 목표</dt>
              <dd>{user.preferences.goal || "아직 정하지 않았어요"}</dd>
            </div>
            <div>
              <dt>코스 활용</dt>
              <dd>새 코스를 만들 때 이 설정을 기본값으로 사용합니다.</dd>
            </div>
          </dl>
        </section>

        <aside className="profile-note">
          <strong>{user.name}</strong>
          <p>{user.email}</p>
          <small>계정</small>
          <p>{user.preferences.interests.join(", ") || "학습 설정을 추가해주세요"}</p>
          <span>
            {[user.preferences.pace, user.preferences.goal].filter(Boolean).join(" / ")}
          </span>
          <span>가입일 {formatDate(user.createdAt)}</span>
          <Link className="profile-note-action" to="/courses">
            내 코스 열기
          </Link>
        </aside>
      </section>

      {isVerifying && (
        <ProfileVerificationForm
          submitLabel="본인 확인 후 수정"
          onVerified={(nextUser, currentPassword) => {
            setUser(nextUser);
            onSessionUpdate(nextUser);
            navigate("/me/edit", {
              state: {
                currentPassword,
                verifiedAt: Date.now(),
              },
            });
          }}
        />
      )}
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

function countSavedSentences(userId: number) {
  try {
    const prefix = `studytube.learningSession:user-${userId}:`;
    let count = 0;
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const value = JSON.parse(window.sessionStorage.getItem(key) ?? "{}") as {
        notes?: unknown[];
      };
      count += Array.isArray(value.notes) ? value.notes.length : 0;
    }
    return count;
  } catch {
    return 0;
  }
}
