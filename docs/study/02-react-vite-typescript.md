# 02. React + Vite + TypeScript

목표는 클론 코딩을 따라칠 때 화면 코드를 읽고 수정할 수 있는 수준까지 익히는 것이다.

## 알아야 할 개념

- `Component`: 화면 조각이다.
- `Props`: 부모 컴포넌트가 자식에게 넘기는 값이다.
- `State`: 화면에서 바뀌는 값이다.
- `Event`: 버튼 클릭, 입력 변경 같은 사용자 행동이다.
- `Router`: 주소에 따라 다른 화면을 보여준다.
- `API call`: 백엔드에 HTTP 요청을 보낸다.

## 기본 문법

컴포넌트:

```tsx
function Page() {
  return <main>화면</main>
}
```

props:

```tsx
function Title({ text }: { text: string }) {
  return <h1>{text}</h1>
}
```

state:

```tsx
import { useState } from 'react'

function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

입력 폼:

```tsx
const [title, setTitle] = useState('')

<input value={title} onChange={(event) => setTitle(event.target.value)} />
```

## 폴더 구조 기준

서비스가 정해지기 전에는 아래 정도만 유지한다.

```txt
web/src/
  components/   재사용 UI
  pages/        주소별 화면
  styles/       CSS
  App.tsx       라우팅
  main.tsx      앱 시작점
```

상태관리 라이브러리는 지금 쓰지 않는다. `useState`, `useEffect`만 먼저 익힌다.

## API 호출 기준

나중에 API를 붙일 때는 `fetch` 또는 `axios` 중 하나만 선택한다. 초보 단계에서는 `axios`가 에러 처리와 JSON 처리가 편하다.

```powershell
cd web
npm.cmd install axios
```

예시:

```tsx
import axios from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
const response = await axios.get(`${apiBaseUrl}/health`)
```

## 클론 코딩할 때 보는 순서

1. 페이지가 몇 개인지 본다.
2. 반복되는 UI를 `components`로 뺀다.
3. 주소가 바뀌면 `pages`로 나눈다.
4. 입력값은 `useState`로 관리한다.
5. 서버 데이터는 `useEffect`에서 가져온다.

## 3일 제한에서 하지 않을 것

- Redux, Zustand
- 복잡한 디자인 시스템
- 무한 스크롤
- 실시간 알림
- 이미지 업로드

먼저 화면, 폼, API 호출만 된다면 충분하다.
