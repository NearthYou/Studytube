import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, isUnauthorizedApiError, parseResponse } from './response'

describe('parseResponse', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageMock())
    vi.stubGlobal('sessionStorage', createStorageMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves status and clears stored auth for unauthorized responses', async () => {
    localStorage.setItem('accessToken', 'expired-token')
    localStorage.setItem('user', JSON.stringify({ id: '1' }))

    await expect(
      parseResponse(
        new Response(JSON.stringify({ message: '유효하지 않은 로그인 토큰입니다.' }), {
          status: 401,
        }),
      ),
    ).rejects.toMatchObject({
      message: '로그인이 만료되었습니다. 다시 로그인해주세요.',
      status: 401,
    })

    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('recognizes unauthorized api errors', () => {
    expect(isUnauthorizedApiError(new ApiError('unauthorized', 401))).toBe(true)
    expect(isUnauthorizedApiError(new Error('unauthorized'))).toBe(false)
  })

  it('unwraps successful api envelopes', async () => {
    const response = await parseResponse<{ id: string }>(
      new Response(
        JSON.stringify({
          data: { id: '42' },
          message: 'ok',
          success: true,
        }),
      ),
    )

    expect(response).toEqual({ id: '42' })
  })
})

function createStorageMock() {
  const items = new Map<string, string>()

  return {
    clear: vi.fn(() => items.clear()),
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    removeItem: vi.fn((key: string) => items.delete(key)),
    setItem: vi.fn((key: string, value: string) => {
      items.set(key, value)
    }),
  }
}
