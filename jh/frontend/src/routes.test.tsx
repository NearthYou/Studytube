import { describe, expect, it } from 'vitest'
import { matchRoute } from './routes'

describe('routes', () => {
  it('matches post and place detail params', () => {
    const postElement = matchRoute('/posts/42') as { props: { postId: string } }
    const placeElement = matchRoute('/pet-places/abc') as { props: { contentId: string } }

    expect(postElement.props.postId).toBe('42')
    expect(placeElement.props.contentId).toBe('abc')
  })

  it('falls back to the feed for unknown paths', () => {
    const element = matchRoute('/unknown') as { type: { name: string } }

    expect(element.type.name).toBe('MainPage')
  })
})
