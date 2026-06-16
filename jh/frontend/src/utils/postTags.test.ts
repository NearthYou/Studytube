import { describe, expect, it } from 'vitest'
import { createNextPostTags } from './postTags'

describe('postTags', () => {
  it('normalizes comma separated tags and removes duplicates', () => {
    expect(createNextPostTags(['daily'], ' #Walk, Daily, Cute ')).toEqual({
      hasCandidates: true,
      nextTags: ['daily', 'walk', 'cute'],
      status: '',
    })
  })

  it('reports max count and max length limits', () => {
    expect(createNextPostTags(['a', 'b', 'c', 'd', 'e'], 'f').status).toBe('태그는 최대 5개까지 입력할 수 있습니다.')
    expect(createNextPostTags([], 'a'.repeat(21)).status).toBe('태그는 20자 이하로 입력해주세요.')
  })
})
