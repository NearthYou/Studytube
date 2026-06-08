import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { Comment, PostWithMeta, User } from '../types/community'
import '../styles/pages/MyPage.css'

type MyPageProps = {
  currentUser: User
  posts: PostWithMeta[]
  commentsByPost: Record<number, Comment[]>
  likedPostIds: Set<number>
  onUpdateProfile: (payload: { nickname: string; password: string }) => boolean
}

type MyPageTab = 'posts' | 'likes' | 'comments' | 'profile'

export function MyPage({
  currentUser,
  posts,
  commentsByPost,
  likedPostIds,
  onUpdateProfile,
}: MyPageProps) {
  const [tab, setTab] = useState<MyPageTab>('posts')
  const [nickname, setNickname] = useState(currentUser.nickname)
  const [password, setPassword] = useState(currentUser.password)

  const myPosts = useMemo(
    () => posts.filter((post) => post.author.id === currentUser.id),
    [currentUser.id, posts],
  )
  const likedPosts = useMemo(
    () => posts.filter((post) => likedPostIds.has(post.id)),
    [likedPostIds, posts],
  )

  const myComments = useMemo(() => {
    return Object.entries(commentsByPost).flatMap(([postId, comments]) => {
      const parentMatches = comments
        .filter((comment) => comment.authorId === currentUser.id)
        .map((comment) => ({
          postId: Number(postId),
          text: comment.content,
          createdAt: comment.createdAt,
          type: '댓글',
        }))

      const replyMatches = comments.flatMap((comment) =>
        comment.replies
          .filter((reply) => reply.authorId === currentUser.id)
          .map((reply) => ({
            postId: Number(postId),
            text: reply.content,
            createdAt: reply.createdAt,
            type: '대댓글',
          })),
      )

      return [...parentMatches, ...replyMatches]
    })
  }, [commentsByPost, currentUser.id])

  return (
    <main className="page mypage-page">
      <section className="profile-banner">
        <span>MYPAGE</span>
        <h1>{currentUser.nickname}</h1>
        <p>{currentUser.bio}</p>
      </section>

      <section className="mypage-tabs">
        <button className={tab === 'posts' ? 'active' : ''} type="button" onClick={() => setTab('posts')}>
          내가 쓴 글
        </button>
        <button className={tab === 'likes' ? 'active' : ''} type="button" onClick={() => setTab('likes')}>
          좋아요한 글
        </button>
        <button className={tab === 'comments' ? 'active' : ''} type="button" onClick={() => setTab('comments')}>
          내가 쓴 댓글
        </button>
        <button className={tab === 'profile' ? 'active' : ''} type="button" onClick={() => setTab('profile')}>
          내 정보 수정
        </button>
      </section>

      {tab === 'posts' ? (
        <section className="mypage-panel">
          {myPosts.length ? (
            myPosts.map((post) => (
              <Link className="mypage-item" key={post.id} to={`/posts/${post.id}`}>
                <strong>{post.title}</strong>
                <span>{post.region} · {post.travelDate}</span>
              </Link>
            ))
          ) : (
            <p className="muted-copy">아직 작성한 게시글이 없습니다.</p>
          )}
        </section>
      ) : null}

      {tab === 'likes' ? (
        <section className="mypage-panel">
          {likedPosts.length ? (
            likedPosts.map((post) => (
              <Link className="mypage-item" key={post.id} to={`/posts/${post.id}`}>
                <strong>{post.title}</strong>
                <span>{post.author.nickname} · 조회 {post.views}</span>
              </Link>
            ))
          ) : (
            <p className="muted-copy">좋아요한 글이 없습니다.</p>
          )}
        </section>
      ) : null}

      {tab === 'comments' ? (
        <section className="mypage-panel">
          {myComments.length ? (
            myComments.map((entry, index) => {
              const post = posts.find((item) => item.id === entry.postId)
              return (
                <Link className="mypage-item" key={`${entry.postId}-${index}`} to={`/posts/${entry.postId}`}>
                  <strong>{entry.type}</strong>
                  <span>{entry.text}</span>
                  <small>
                    {post?.title ?? '알 수 없는 글'} · {entry.createdAt}
                  </small>
                </Link>
              )
            })
          ) : (
            <p className="muted-copy">아직 작성한 댓글이 없습니다.</p>
          )}
        </section>
      ) : null}

      {tab === 'profile' ? (
        <section className="mypage-panel">
          <form
            className="profile-edit-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!nickname.trim() || !password.trim()) {
                window.alert('닉네임과 비밀번호를 입력해주세요.')
                return
              }
              const success = onUpdateProfile({
                nickname: nickname.trim(),
                password: password.trim(),
              })
              if (!success) {
                window.alert('중복된 닉네임입니다.')
                return
              }
              window.alert('내 정보가 수정되었습니다.')
            }}
          >
            <label>
              이름
              <input disabled value={currentUser.name} />
            </label>
            <label>
              이메일
              <input disabled value={currentUser.email} />
            </label>
            <label>
              닉네임
              <input value={nickname} onChange={(event) => setNickname(event.target.value)} />
            </label>
            <label>
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="primary-button" type="submit">
              수정 저장
            </button>
          </form>
        </section>
      ) : null}
    </main>
  )
}
