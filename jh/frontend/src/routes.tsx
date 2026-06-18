import type { ReactElement } from 'react'
import { LoginPage } from './pages/LoginPage'
import { MainPage } from './pages/MainPage'
import { MyPage } from './pages/MyPage'
import { PetPlaceDetailPage } from './pages/PetPlaceDetailPage'
import { PetPlacesPage } from './pages/PetPlacesPage'
import { PostCreatePage } from './pages/PostCreatePage'
import { PostDeletePage } from './pages/PostDeletePage'
import { PostDetailPage } from './pages/PostDetailPage'
import { PostEditPage } from './pages/PostEditPage'
import { SignupPage } from './pages/SignupPage'
import { SocialCallbackPage } from './pages/SocialCallbackPage'

type AppRoute = {
  pattern: RegExp
  render: (match: RegExpMatchArray) => ReactElement
}

const routes: AppRoute[] = [
  { pattern: /^\/login$/, render: () => <LoginPage /> },
  { pattern: /^\/signup$/, render: () => <SignupPage /> },
  { pattern: /^\/social\/callback$/, render: () => <SocialCallbackPage /> },
  { pattern: /^\/mypage$/, render: () => <MyPage /> },
  { pattern: /^\/pet-places$/, render: () => <PetPlacesPage /> },
  { pattern: /^\/pet-places\/([^/]+)$/, render: (match) => <PetPlaceDetailPage contentId={match[1]} /> },
  { pattern: /^\/posts\/new$/, render: () => <PostCreatePage /> },
  { pattern: /^\/posts\/([^/]+)\/edit$/, render: (match) => <PostEditPage postId={match[1]} /> },
  { pattern: /^\/posts\/([^/]+)\/delete$/, render: (match) => <PostDeletePage postId={match[1]} /> },
  { pattern: /^\/posts\/([^/]+)$/, render: (match) => <PostDetailPage postId={match[1]} /> },
]

export function matchRoute(pathname: string) {
  for (const route of routes) {
    const match = pathname.match(route.pattern)

    if (match) {
      return route.render(match)
    }
  }

  return <MainPage />
}
