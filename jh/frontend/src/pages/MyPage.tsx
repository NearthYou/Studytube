import { CalendarDays, Heart, LogIn, Mail, MapPin, MessageCircle, Newspaper, UserCircle } from 'lucide-react'
import { resolveApiAssetUrl } from '../api/base'
import { AppLayout } from '../components/layout/AppLayout'
import { openAuthModal } from '../utils/authModal'
import { getStoredUser } from '../utils/authStorage'
import { appPaths } from '../utils/paths'

export function MyPage() {
  const user = getStoredUser()

  if (!user) {
    return (
      <AppLayout variant="board">
        <section className="mypage-panel mypage-empty" aria-labelledby="mypage-title">
          <div className="mypage-empty-icon" aria-hidden="true">
            <UserCircle size={44} />
          </div>
          <div>
            <p className="mypage-kicker">마이페이지</p>
            <h1 id="mypage-title">로그인이 필요합니다</h1>
            <p>내 계정 정보를 확인하려면 먼저 로그인해주세요.</p>
          </div>
          <button
            className="ui-button ui-button--primary primary-login-button"
            type="button"
            onClick={() => openAuthModal({ mode: 'login', redirectPath: appPaths.myPage })}
          >
            <LogIn size={16} aria-hidden="true" />
            <span>로그인</span>
          </button>
        </section>
      </AppLayout>
    )
  }

  const joinedAt = new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'long',
  }).format(new Date(user.createdAt))

  return (
    <AppLayout variant="board">
      <section className="mypage-panel" aria-labelledby="mypage-title">
        <div className="mypage-profile">
          <div className="mypage-avatar">
            {user.profileImageUrl ? (
              <img src={resolveApiAssetUrl(user.profileImageUrl)} alt="" />
            ) : (
              <UserCircle size={58} aria-hidden="true" />
            )}
          </div>
          <div className="mypage-profile-copy">
            <p className="mypage-kicker">마이페이지</p>
            <h1 id="mypage-title">{user.nickname}</h1>
            <p>Tail Talk에서 사용하는 내 계정 정보입니다.</p>
          </div>
        </div>

        <div className="mypage-info-grid">
          <article className="mypage-info-item">
            <Mail size={18} aria-hidden="true" />
            <div>
              <span>이메일</span>
              <strong>{user.email}</strong>
            </div>
          </article>
          <article className="mypage-info-item">
            <CalendarDays size={18} aria-hidden="true" />
            <div>
              <span>가입일</span>
              <strong>{joinedAt}</strong>
            </div>
          </article>
        </div>

        <section className="mypage-activity" aria-labelledby="mypage-activity-title">
          <div>
            <p className="mypage-kicker">커뮤니티 활동</p>
            <h2 id="mypage-activity-title">내 활동을 한눈에 볼 수 있게 준비 중입니다</h2>
          </div>
          <div className="mypage-activity-grid">
            <a className="mypage-activity-card" href={appPaths.home}>
              <Newspaper size={18} aria-hidden="true" />
              <strong>내 게시글</strong>
              <span>작성한 꼬리톡 모아보기</span>
            </a>
            <a className="mypage-activity-card" href={appPaths.home}>
              <MessageCircle size={18} aria-hidden="true" />
              <strong>댓글 단 글</strong>
              <span>대화가 이어진 글 확인</span>
            </a>
            <a className="mypage-activity-card" href={appPaths.home}>
              <Heart size={18} aria-hidden="true" />
              <strong>좋아요한 글</strong>
              <span>다시 보고 싶은 글 저장</span>
            </a>
            <a className="mypage-activity-card" href={appPaths.petPlaces}>
              <MapPin size={18} aria-hidden="true" />
              <strong>최근 장소 활동</strong>
              <span>산책 장소 탐색 이어가기</span>
            </a>
          </div>
        </section>
      </section>
    </AppLayout>
  )
}
