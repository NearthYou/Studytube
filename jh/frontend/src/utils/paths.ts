import type { CategoryValue } from '../types/category'

export const appPaths = {
  home: '/',
  login: '/login',
  myPage: '/mypage',
  petPlaces: '/pet-places',
  petPlaceDetail: (contentId: string | number) => `/pet-places/${contentId}`,
  postCreate: '/posts/new',
  postDelete: (postId: string | number) => `/posts/${postId}/delete`,
  postDetail: (postId: string | number) => `/posts/${postId}`,
  postEdit: (postId: string | number) => `/posts/${postId}/edit`,
  signup: '/signup',
  socialCallback: '/social/callback',
}

export function getCategoryPath(categoryValue: CategoryValue) {
  if (categoryValue === 'all') {
    return appPaths.home
  }

  return `${appPaths.home}?category=${encodeURIComponent(categoryValue)}`
}

export function getLoginPath(redirectPath?: string) {
  if (!redirectPath) {
    return appPaths.login
  }

  return `${appPaths.login}?redirect=${encodeURIComponent(toSafeRedirectPath(redirectPath))}`
}

export function getSearchPath(keyword: string) {
  const trimmedKeyword = keyword.trim()

  if (!trimmedKeyword) {
    return appPaths.home
  }

  return `${appPaths.home}?q=${encodeURIComponent(trimmedKeyword)}`
}

export function getTagPath(tagName: string) {
  const trimmedTagName = tagName.trim()

  if (!trimmedTagName) {
    return appPaths.home
  }

  return `${appPaths.home}?tag=${encodeURIComponent(trimmedTagName)}`
}

export function getPostDetailPath(postId: string | number, returnPath?: string) {
  const detailPath = appPaths.postDetail(postId)

  if (!returnPath) {
    return detailPath
  }

  return `${detailPath}?from=${encodeURIComponent(toSafeRedirectPath(returnPath))}`
}

export function getReturnPath(search = window.location.search, fallbackPath = appPaths.home) {
  const from = new URLSearchParams(search).get('from')

  return from ? toSafeRedirectPath(from) : fallbackPath
}

export function toSafeRedirectPath(redirectPath: string) {
  return redirectPath.startsWith('/') && !redirectPath.startsWith('//') ? redirectPath : appPaths.home
}
