import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { fetchMe, fetchPosts } from "../../api";
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
  const [postCount, setPostCount] = useState(0);
  const [playlistCount, setPlaylistCount] = useState(0);
  const [status, setStatus] = useState("계정 정보를 불러오는 중입니다.");
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        const [nextUser, postResult, nextPlaylists] = await Promise.all([
          fetchMe(),
          fetchPosts("", 1, 1),
          fetchOwnerCourses(),
        ]);

        if (!mounted) {
          return;
        }

        setUser(nextUser);
        setPostCount(postResult.total);
        setPlaylistCount(nextPlaylists.length);
        onSessionUpdate(nextUser);
        setStatus("계정 정보가 최신 상태입니다.");
      } catch {
        if (mounted) {
          setStatus("계정 정보를 불러오지 못했습니다. 서버 상태를 확인하세요.");
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
          <p className="eyebrow">My page</p>
          <h1>내 정보</h1>
          <p>
            계정 정보와 학습 취향을 확인합니다. 수정하려면 현재 비밀번호로 본인
            확인을 먼저 진행합니다.
          </p>
          <div className="profile-actions">
            <Link className="primary-link" to="/courses">
              내 Course 보기
            </Link>
            <button
              className="secondary-action"
              type="button"
              onClick={() => setIsVerifying((current) => !current)}
            >
              정보 수정
            </button>
          </div>
        </div>
        <div className="profile-stats" aria-label="내 학습 데이터">
          <span>
            <strong>{playlistCount}</strong>
            보드 플레이리스트
          </span>
          <span>
            <strong>{postCount}</strong>
            등록 영상
          </span>
        </div>
      </section>

      <section className="profile-layout">
        <section className="profile-read-panel">
          <div className="section-title">
            <h2>계정 정보</h2>
            <span>{status}</span>
          </div>
          <dl className="profile-info-list">
            <div>
              <dt>이름</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt>이메일</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>관심사</dt>
              <dd>{user.preferences.interests.join(", ")}</dd>
            </div>
            <div>
              <dt>학습 속도</dt>
              <dd>{user.preferences.pace}</dd>
            </div>
            <div>
              <dt>학습 목표</dt>
              <dd>{user.preferences.goal}</dd>
            </div>
            <div>
              <dt>가입일</dt>
              <dd>{formatDate(user.createdAt)}</dd>
            </div>
          </dl>
        </section>

        <aside className="profile-note">
          <strong>{user.name}</strong>
          <p>{user.email}</p>
          <small>현재 학습 취향</small>
          <p>{user.preferences.interests.join(", ")}</p>
          <span>
            {user.preferences.pace} / {user.preferences.goal}
          </span>
          <span>가입일 {formatDate(user.createdAt)}</span>
          <Link className="profile-note-action" to="/courses">
            내 Course 열기
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
