import { describe, expect, it } from 'vitest'
import {
  appPaths,
  getCategoryPath,
  getLoginPath,
  getPostDetailPath,
  getReturnPath,
  getSearchPath,
  getTagPath,
  toSafeRedirectPath,
} from './paths'

describe('paths', () => {
  it('builds common app paths', () => {
    expect(getCategoryPath('all')).toBe(appPaths.home)
    expect(getCategoryPath('walk')).toBe('/?category=walk')
    expect(getSearchPath(' 산책 ')).toBe('/?q=%EC%82%B0%EC%B1%85')
    expect(getTagPath(' cute ')).toBe('/?tag=cute')
  })

  it('guards redirects against protocol-relative paths', () => {
    expect(toSafeRedirectPath('/posts/1')).toBe('/posts/1')
    expect(toSafeRedirectPath('//evil.test')).toBe(appPaths.home)
    expect(getLoginPath('/posts/1')).toBe('/login?redirect=%2Fposts%2F1')
  })

  it('preserves return path on post detail links', () => {
    expect(getPostDetailPath(7, '/?category=walk&page=2')).toBe('/posts/7?from=%2F%3Fcategory%3Dwalk%26page%3D2')
    expect(getReturnPath('?from=%2F%3Fcategory%3Dwalk')).toBe('/?category=walk')
    expect(getReturnPath('?from=%2F%2Fevil.test')).toBe('/')
  })
})
