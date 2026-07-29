# 04. React와 NestJS 연결하기

이 문서는 React 화면이 NestJS API를 호출하도록 바꾸는 단계다.

목표:

```txt
React의 임시 posts 배열 제거
NestJS GET /posts 호출
NestJS POST /posts 호출
```

## 1. 지금까지 구조

React는 지금 자기 파일 안의 임시 데이터를 읽고 있다.

```txt
React -> web/src/data/posts.ts
```

이제 구조를 바꾼다.

```txt
React -> HTTP 요청 -> NestJS
```

## 2. axios 설치

터미널:

```powershell
npm.cmd --prefix web install axios
```

axios는 HTTP 요청을 쉽게 보내는 라이브러리다.

## 3. API 주소 확인

파일:

```txt
web/.env
```

값:

```txt
VITE_API_BASE_URL=http://localhost:3000
```

React에서는 이렇게 읽는다.

```ts
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
```

## 4. API 클라이언트 파일 만들기

파일 생성:

```txt
web/src/api/postsApi.ts
```

코드:

```ts
import axios from 'axios'

export type Post = {
  id: number
  title: string
  content: string
  author: string
  createdAt: string
}

export type CreatePostRequest = {
  title: string
  content: string
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

export async function getPosts() {
  const response = await axios.get<Post[]>(`${apiBaseUrl}/posts`)
  return response.data
}

export async function getPost(id: number) {
  const response = await axios.get<Post>(`${apiBaseUrl}/posts/${id}`)
  return response.data
}

export async function createPost(data: CreatePostRequest) {
  const response = await axios.post<Post>(`${apiBaseUrl}/posts`, data)
  return response.data
}
```

설명:

```txt
getPosts = 글 목록 API 호출
getPost = 글 상세 API 호출
createPost = 글 작성 API 호출
```

## 5. 글 목록 페이지 수정

파일:

```txt
web/src/pages/PostListPage.tsx
```

코드:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getPosts, Post } from '../api/postsApi'

function PostListPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadPosts() {
      const data = await getPosts()
      setPosts(data)
      setIsLoading(false)
    }

    loadPosts()
  }, [])

  if (isLoading) {
    return <main>불러오는 중...</main>
  }

  return (
    <main>
      <h1>글 목록</h1>

      <Link to="/posts/new">글 작성</Link>

      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            <Link to={`/posts/${post.id}`}>{post.title}</Link>
            <p>
              {post.author} / {post.createdAt}
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
useEffect는 화면이 처음 뜰 때 실행된다.
getPosts로 NestJS API를 호출한다.
setPosts로 화면 데이터를 바꾼다.
```

## 6. 글 상세 페이지 수정

파일:

```txt
web/src/pages/PostDetailPage.tsx
```

코드:

```tsx
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getPost, Post } from '../api/postsApi'

function PostDetailPage() {
  const params = useParams()
  const postId = Number(params.id)
  const [post, setPost] = useState<Post | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadPost() {
      const data = await getPost(postId)
      setPost(data)
      setIsLoading(false)
    }

    loadPost()
  }, [postId])

  if (isLoading) {
    return <main>불러오는 중...</main>
  }

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
        {post.author} / {post.createdAt}
      </p>
      <p>{post.content}</p>
    </main>
  )
}

export default PostDetailPage
```

## 7. 글 작성 페이지 수정

파일:

```txt
web/src/pages/PostNewPage.tsx
```

코드:

```tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { createPost } from '../api/postsApi'

function PostNewPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const post = await createPost({
      title,
      content,
    })

    navigate(`/posts/${post.id}`)
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
createPost로 NestJS에 POST 요청을 보낸다.
응답으로 받은 post.id를 사용해 상세 페이지로 이동한다.
```

## 8. 확인

서버 2개를 켠다.

```powershell
npm.cmd run dev:api
npm.cmd run dev:web
```

브라우저:

```txt
http://localhost:5173/posts
```

성공 기준:

```txt
React 목록 화면이 NestJS 데이터를 보여준다.
글 작성 후 상세 페이지로 이동한다.
```

주의:

```txt
아직 DB가 없어서 API 서버를 재시작하면 작성한 글은 사라진다.
```
