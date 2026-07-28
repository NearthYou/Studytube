# 02. React 미니 게시판 코드 따라치기

이 문서는 React 화면을 직접 따라 치는 문서다.

목표:

```txt
/posts      글 목록
/posts/1    글 상세
/posts/new  글 작성
```

## 0. 실행

터미널에서 실행한다.

```powershell
npm.cmd run dev:web
```

브라우저:

```txt
http://localhost:5173
```

## 1. 데이터 파일 만들기

파일 생성:

```txt
web/src/data/posts.ts
```

코드:

```ts
export type Post = {
  id: number
  title: string
  content: string
  author: string
  createdAt: string
}

export const posts: Post[] = [
  {
    id: 1,
    title: 'React 컴포넌트 질문',
    content: '컴포넌트를 어떻게 나누면 좋을지 연습 중입니다.',
    author: 'student',
    createdAt: '2026-06-06',
  },
  {
    id: 2,
    title: 'NestJS Controller 정리',
    content: 'Controller는 HTTP 요청을 받는 입구입니다.',
    author: 'student',
    createdAt: '2026-06-06',
  },
]
```

설명:

```txt
Post 타입은 글 하나의 모양이다.
posts 배열은 화면에 보여줄 임시 데이터다.
```

## 2. 글 목록 페이지 만들기

파일 생성:

```txt
web/src/pages/PostListPage.tsx
```

코드:

```tsx
import { Link } from 'react-router'
import { posts } from '../data/posts'

function PostListPage() {
  return (
    <main>
      <h1>글 목록</h1>

      <Link to="/posts/new">글 작성</Link>

      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            <Link to={`/posts/${post.id}`}>{post.title}</Link>
            <p>
              {post.author} · {post.createdAt}
            </p>
          </li>
        ))}
      </ul>
    </main>
  )
}

export default PostListPage
```

설명:

```txt
posts.map으로 글 배열을 li 목록으로 바꾼다.
Link를 누르면 상세 페이지로 이동한다.
```

## 3. 글 상세 페이지 만들기

파일 생성:

```txt
web/src/pages/PostDetailPage.tsx
```

코드:

```tsx
import { Link, useParams } from 'react-router'
import { posts } from '../data/posts'

function PostDetailPage() {
  const params = useParams()
  const postId = Number(params.id)
  const post = posts.find((item) => item.id === postId)

  if (!post) {
    return (
      <main>
        <h1>글을 찾을 수 없습니다.</h1>
        <Link to="/posts">목록으로</Link>
      </main>
    )
  }

  return (
    <main>
      <Link to="/posts">목록으로</Link>
      <h1>{post.title}</h1>
      <p>
        {post.author} · {post.createdAt}
      </p>
      <p>{post.content}</p>
    </main>
  )
}

export default PostDetailPage
```

설명:

```txt
useParams로 주소의 id를 읽는다.
find로 id가 같은 글을 찾는다.
글이 없으면 "글을 찾을 수 없습니다"를 보여준다.
```

## 4. 글 작성 페이지 만들기

파일 생성:

```txt
web/src/pages/PostNewPage.tsx
```

코드:

```tsx
import { useState } from 'react'
import { Link } from 'react-router'

function PostNewPage() {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    console.log({
      title,
      content,
    })

    alert('지금은 콘솔에만 출력합니다.')
  }

  return (
    <main>
      <Link to="/posts">목록으로</Link>
      <h1>글 작성</h1>

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="title">제목</label>
          <input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="content">본문</label>
          <textarea
            id="content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </div>

        <button type="submit">저장</button>
      </form>
    </main>
  )
}

export default PostNewPage
```

설명:

```txt
useState로 제목과 본문 입력값을 저장한다.
onChange는 입력할 때마다 실행된다.
onSubmit은 저장 버튼을 눌렀을 때 실행된다.
event.preventDefault는 새로고침을 막는다.
```

## 5. App.tsx 수정하기

파일:

```txt
web/src/App.tsx
```

전체 코드를 아래처럼 바꾼다.

```tsx
import './App.css'
import { Link, Route, Routes } from 'react-router'
import AboutPage from './pages/AboutPage'
import Hompage from './pages/Hompage'
import NotFoundPage from './pages/NotFoundPage'
import PostDetailPage from './pages/PostDetailPage'
import PostListPage from './pages/PostListPage'
import PostNewPage from './pages/PostNewPage'
import UsersPage from './pages/UsersPage'

function App() {
  return (
    <>
      <header>
        <nav>
          <Link to="/">Home</Link> {' | '}
          <Link to="/about">About</Link> {' | '}
          <Link to="/users">Users</Link> {' | '}
          <Link to="/posts">Posts</Link>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<Hompage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/posts" element={<PostListPage />} />
        <Route path="/posts/new" element={<PostNewPage />} />
        <Route path="/posts/:id" element={<PostDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}

export default App
```

## 6. 확인

브라우저에서 확인한다.

```txt
http://localhost:5173/posts
http://localhost:5173/posts/1
http://localhost:5173/posts/new
```

성공 기준:

```txt
글 목록이 보인다.
글 제목을 누르면 상세로 간다.
글 작성 화면에서 입력 후 저장을 누르면 console.log가 찍힌다.
```
