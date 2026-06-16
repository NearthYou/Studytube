import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCurrentPathWithSearch, navigate, replaceCurrentPath } from './navigation'

describe('navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('centralizes assign and replace navigation', () => {
    const assign = vi.fn()
    const replace = vi.fn()
    const replaceState = vi.fn()

    vi.stubGlobal('window', {
      location: {
        assign,
        pathname: '/posts/1',
        replace,
        search: '?from=%2F',
      },
      history: {
        replaceState,
      },
    } as unknown as Window & typeof globalThis)

    navigate('/login')
    navigate('/signup', { replace: true })
    replaceCurrentPath('/social/callback')

    expect(assign).toHaveBeenCalledWith('/login')
    expect(replace).toHaveBeenCalledWith('/signup')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/social/callback')
    expect(getCurrentPathWithSearch()).toBe('/posts/1?from=%2F')
  })
})
