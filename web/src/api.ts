import type {
  AgentResponse,
  CaptionResponse,
  McpResponse,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  RagResponse,
  Session,
  StudyPost,
  User,
  VideoSummaryResponse,
} from './types';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ??
  'http://localhost:3000';

export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = `API ${response.status}: ${response.statusText}`;

    try {
      const errorBody = (await response.json()) as {
        error?: string;
        message?: string | string[];
      };
      const bodyMessage = Array.isArray(errorBody.message)
        ? errorBody.message.join(' ')
        : errorBody.message;
      message = bodyMessage || errorBody.error || message;
    } catch {
      // Keep the HTTP fallback message when the response body is not JSON.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function apiBaseUrl() {
  return API_BASE_URL;
}

export function demoSession(): Promise<Session> {
  return requestJson<Session>('/auth/demo', { method: 'POST' });
}

export function signUp(input: {
  name: string;
  email: string;
  password: string;
}): Promise<Session> {
  return requestJson<Session>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function login(input: {
  email: string;
  password: string;
}): Promise<Session> {
  return requestJson<Session>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchMe(token: string): Promise<User> {
  return requestJson<User>('/me', {}, token);
}

export function updateMe(
  token: string,
  input: {
    name?: string;
    password?: string;
  },
): Promise<User> {
  return requestJson<User>(
    '/me',
    { method: 'PUT', body: JSON.stringify(input) },
    token,
  );
}

export function fetchPosts(
  token: string,
  search: string,
  page: number,
  pageSize = 6,
): Promise<PaginatedPosts> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (search.trim()) {
    params.set('search', search.trim());
  }

  return requestJson<PaginatedPosts>(`/posts?${params.toString()}`, {}, token);
}

export function fetchPublicPosts(
  search: string,
  page: number,
  pageSize = 12,
): Promise<PaginatedPosts> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (search.trim()) {
    params.set('search', search.trim());
  }

  return requestJson<PaginatedPosts>(`/explore/posts?${params.toString()}`);
}

export function createPost(
  token: string,
  input: {
    title: string;
    videoUrl: string;
    thumbnailUrl?: string;
    channelName: string;
    summary: string;
    translatedNotes: string;
    tags: string[];
  },
): Promise<StudyPost> {
  return requestJson<StudyPost>(
    '/posts',
    { method: 'POST', body: JSON.stringify(input) },
    token,
  );
}

export function updatePost(
  token: string,
  id: number,
  input: Partial<StudyPost>,
): Promise<StudyPost> {
  return requestJson<StudyPost>(
    `/posts/${id}`,
    { method: 'PUT', body: JSON.stringify(input) },
    token,
  );
}

export function deletePost(token: string, id: number) {
  return requestJson<{ deleted: boolean }>(
    `/posts/${id}`,
    { method: 'DELETE' },
    token,
  );
}

export function addComment(token: string, postId: number, body: string) {
  return requestJson(
    `/posts/${postId}/comments`,
    { method: 'POST', body: JSON.stringify({ body }) },
    token,
  );
}

export function fetchPlaylists(token: string): Promise<Playlist[]> {
  return requestJson<Playlist[]>('/playlists', {}, token);
}

export function createPlaylist(
  token: string,
  input: { title: string; description: string; postIds: number[] },
) {
  return requestJson<Playlist>(
    '/playlists',
    { method: 'POST', body: JSON.stringify(input) },
    token,
  );
}

export function addPlaylistFeedback(
  token: string,
  playlistId: number,
  input: { rating: number; body: string },
): Promise<PlaylistFeedback> {
  return requestJson<PlaylistFeedback>(
    `/playlists/${playlistId}/feedback`,
    { method: 'POST', body: JSON.stringify(input) },
    token,
  );
}

export function askRag(query: string): Promise<RagResponse> {
  return requestJson<RagResponse>('/ai/rag/recommend', {
    method: 'POST',
    body: JSON.stringify({ query, limit: 5 }),
  });
}

export function askMcp(
  input: string | { query?: string; url?: string; limit?: number },
): Promise<McpResponse> {
  const body =
    typeof input === 'string'
      ? { query: input }
      : {
          ...input,
        };

  return requestJson<McpResponse>('/ai/mcp/youtube', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function askAgent(goal: string): Promise<AgentResponse> {
  return requestJson<AgentResponse>('/ai/agent/study-plan', {
    method: 'POST',
    body: JSON.stringify({
      goal,
      language: 'ko',
      interests: ['youtube', 'study'],
    }),
  });
}

export function fetchTranslatedCaptions(input: {
  videoId: string;
  videoUrl: string;
  targetLanguage?: string;
  fallbackText?: string;
  allowFallback?: boolean;
  translateFallback?: boolean;
  durationSeconds?: number;
}): Promise<CaptionResponse> {
  return requestJson<CaptionResponse>('/ai/youtube/captions', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      targetLanguage: input.targetLanguage ?? 'ko',
    }),
  });
}

export function fetchVideoSummary(input: {
  videoId: string;
  title: string;
  channelName: string;
  language?: string;
  summary?: string;
  translatedNotes?: string;
  segments: Array<{ start: number; end: number; text: string }>;
}): Promise<VideoSummaryResponse> {
  return requestJson<VideoSummaryResponse>('/ai/youtube/summary', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      language: input.language ?? 'ko',
    }),
  });
}
