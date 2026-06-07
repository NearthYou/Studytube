import type {
  AgentResponse,
  McpResponse,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  RagResponse,
  Session,
  StudyPost,
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
    throw new Error(`API ${response.status}: ${response.statusText}`);
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

export function fetchPosts(
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

  return requestJson<PaginatedPosts>(`/posts?${params.toString()}`);
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
