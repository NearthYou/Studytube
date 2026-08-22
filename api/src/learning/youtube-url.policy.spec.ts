import { canonicalizeYoutubeUrl } from './youtube-url.policy';

describe('canonicalizeYoutubeUrl', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=share-token&t=12',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
  ])('returns one canonical identity for %s', (url) => {
    expect(canonicalizeYoutubeUrl(url)).toEqual({
      provider: 'youtube',
      canonicalVideoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  });

  it.each([
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com:444/watch?v=dQw4w9WgXcQ',
    'https://127.0.0.1/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=abcdefghijk',
    'https://www.youtube.com/watch?v=dQw4w9Wg%58cQ',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://www.youtube.com/watch?v=too-short',
  ])('rejects non-canonical or unsafe input %s', (url) => {
    expect(() => canonicalizeYoutubeUrl(url)).toThrow('INVALID_YOUTUBE_URL');
  });
});
