import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { fetchMe } from "../../api";
import { fetchOwnerCourses } from "../../courseApi";
import { normalizeLearningPace } from "../../courseDiscovery";
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
  const [status, setStatus] = useState("추천을 불러오는 중이에요.");
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
        setStatus("현재 설정");
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
          setStatus("추천 설정을 불러오지 못했어요.");
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
            이어서 볼 코스와 저장한 문장을 확인하세요.
          </p>
          <div className="profile-actions">
            <Link className="primary-link" to="/">
              이어서 학습
            </Link>
            <Link className="secondary-link" to="/me/preferences">
              추천 바꾸기
            </Link>
            <button
              className="secondary-action"
              type="button"
              onClick={() => setIsVerifying((current) => !current)}
            >
              내 정보 수정
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
            <h2>코스 추천</h2>
            <span>{status}</span>
          </div>
          <dl className="profile-info-list">
            <div>
              <dt>배우고 싶은 분야</dt>
              <dd>{user.preferences.interests.join(", ") || "아직 정하지 않았어요"}</dd>
            </div>
            <div>
              <dt>한 번에 볼 시간</dt>
              <dd>
                {normalizeLearningPace(user.preferences.pace) ||
                  "아직 정하지 않았어요"}
              </dd>
            </div>
            <div>
              <dt>배우는 방식</dt>
              <dd>{user.preferences.goal || "아직 정하지 않았어요"}</dd>
            </div>
            <div>
              <dt>어디에 쓰이나요?</dt>
              <dd>
                분야는 검색 주제에, 시간은 영상 길이에, 배우는 방식은 어떤 영상을 먼저 고를지 정할 때 써요.
              </dd>
            </div>
          </dl>
        </section>

        <aside className="profile-note">
          <strong>{user.name}</strong>
          <p>{user.email}</p>
          <small>계정</small>
          <p>{user.preferences.interests.join(", ") || "코스 추천을 맞춰주세요"}</p>
          <span>
            {[normalizeLearningPace(user.preferences.pace), user.preferences.goal]
              .filter(Boolean)
              .join(" / ")}
          </span>
          <span>가입일 {formatDate(user.createdAt)}</span>
          <Link className="profile-note-action" to="/courses">
            내 코스 열기
          </Link>
        </aside>
      </section>

      {isVerifying && (
        <ProfileVerificationForm
          submitLabel="확인하고 수정"
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
