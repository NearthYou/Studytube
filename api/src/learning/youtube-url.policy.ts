export type CanonicalYoutubeVideo = Readonly<{
  provider: 'youtube';
  canonicalVideoId: string;
  canonicalUrl: string;
}>;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);

export class InvalidYoutubeUrlError extends Error {
  readonly code = 'INVALID_YOUTUBE_URL';

  constructor() {
    super('INVALID_YOUTUBE_URL');
  }
}

export function canonicalizeYoutubeUrl(input: string): CanonicalYoutubeVideo {
  if (
    typeof input !== 'string' ||
    input.length > 2_048 ||
    input.trim() !== input
  ) {
    throw new InvalidYoutubeUrlError();
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidYoutubeUrlError();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hash !== '' ||
    /%/u.test(url.pathname) ||
    /[?&]v=[^&]*%/u.test(url.search)
  ) {
    throw new InvalidYoutubeUrlError();
  }

  const host = url.hostname.toLowerCase();
  let videoId: string | undefined;
  if (host === 'youtu.be') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 1) videoId = parts[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      const values = url.searchParams.getAll('v');
      if (values.length !== 1) throw new InvalidYoutubeUrlError();
      videoId = values[0];
    } else {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 2 && parts[0] === 'shorts') {
        videoId = parts[1];
      }
    }
  }
  if (!videoId || !VIDEO_ID.test(videoId)) {
    throw new InvalidYoutubeUrlError();
  }
  return Object.freeze({
    provider: 'youtube',
    canonicalVideoId: videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  });
}
