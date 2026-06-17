import type {
  AgentResponse,
  CaptionResponse,
  Comment as StudyComment,
  McpResponse,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  RagResponse,
  Session,
  StudyPost,
  User,
  VideoAsset,
  VideoSummaryResponse,
} from "./types";

type BrowserLocation = Pick<Location, "hostname" | "protocol">;

const viteEnv = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env;

const API_BASE_URL = resolveApiBaseUrl(
  viteEnv?.VITE_API_BASE_URL,
  globalThis.location,
);

export function resolveApiBaseUrl(
  configuredUrl?: string,
  currentLocation?: BrowserLocation,
) {
  const fallbackUrl =
    currentLocation && !isLocalHostname(currentLocation.hostname)
      ? `${currentLocation.protocol}//${currentLocation.hostname}:3000`
      : "http://localhost:3000";
  const normalizedUrl = configuredUrl?.trim().replace(/\/$/, "") || fallbackUrl;

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (
      currentLocation &&
      isLocalHostname(parsedUrl.hostname) &&
      !isLocalHostname(currentLocation.hostname)
    ) {
      parsedUrl.protocol = currentLocation.protocol;
      parsedUrl.hostname = currentLocation.hostname;
      parsedUrl.port ||= "3000";

      return parsedUrl.toString().replace(/\/$/, "");
    }
  } catch {
    return normalizedUrl;
  }

  return normalizedUrl;
}

function isLocalHostname(hostname: string) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

export class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export function isUnauthorizedRequest(error: unknown) {
  return error instanceof ApiRequestError && error.status === 401;
}

export function isNotFoundRequest(error: unknown) {
  return error instanceof ApiRequestError && error.status === 404;
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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
        ? errorBody.message.join(" ")
        : errorBody.message;
      message = bodyMessage || errorBody.error || message;
    } catch {
      // Keep the HTTP fallback message when the response body is not JSON.
    }

    throw new ApiRequestError(response.status, message);
  }

  return response.json() as Promise<T>;
}

export function apiBaseUrl() {
  return API_BASE_URL;
}

export function demoSession(): Promise<Session> {
  return requestJson<Session>("/auth/demo", { method: "POST" });
}

export function signUp(input: {
  name: string;
  email: string;
  password: string;
}): Promise<Session> {
  return requestJson<Session>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: {
  email: string;
  password: string;
}): Promise<Session> {
  return requestJson<Session>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchMe(token: string): Promise<User> {
  return requestJson<User>("/me", {}, token);
}

export function verifyMe(
  token: string,
  input: {
    currentPassword: string;
  },
): Promise<User> {
  return requestJson<User>(
    "/me/verify",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export function updateMe(
  token: string,
  input: {
    currentPassword: string;
    name?: string;
    password?: string;
    preferences?: {
      interests: string[];
      pace: string;
      goal: string;
    };
  },
): Promise<User> {
  return requestJson<User>(
    "/me",
    { method: "PUT", body: JSON.stringify(input) },
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
    params.set("search", search.trim());
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
    params.set("search", search.trim());
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
    "/posts",
    { method: "POST", body: JSON.stringify(input) },
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
    { method: "PUT", body: JSON.stringify(input) },
    token,
  );
}

export function deletePost(token: string, id: number) {
  return requestJson<{ deleted: boolean }>(
    `/posts/${id}`,
    { method: "DELETE" },
    token,
  );
}

export function fetchVideoAsset(
  postId: number,
  token?: string,
): Promise<VideoAsset> {
  return requestJson<VideoAsset>(`/posts/${postId}/video-asset`, {}, token);
}

export function prepareVideoAsset(
  postId: number,
  token?: string,
): Promise<VideoAsset> {
  return requestJson<VideoAsset>(
    `/posts/${postId}/video-asset/prepare`,
    { method: "POST" },
    token,
  );
}

export function addComment(token: string, postId: number, body: string) {
  return requestJson<StudyComment>(
    `/posts/${postId}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
    token,
  );
}

export function deleteComment(
  token: string,
  postId: number,
  commentId: number,
) {
  return requestJson<{ deleted: boolean }>(
    `/posts/${postId}/comments/${commentId}`,
    { method: "DELETE" },
    token,
  );
}

export function fetchPlaylists(token: string): Promise<Playlist[]> {
  return requestJson<Playlist[]>("/playlists", {}, token);
}

export function fetchPublicPlaylists(): Promise<Playlist[]> {
  return requestJson<Playlist[]>("/playlists");
}

export function createPlaylist(
  token: string,
  input: { title: string; description: string; postIds: number[] },
) {
  return requestJson<Playlist>(
    "/playlists",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export function updatePlaylist(
  token: string,
  id: number,
  input: { title?: string; description?: string; postIds?: number[] },
) {
  return requestJson<Playlist>(
    `/playlists/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
    token,
  );
}

export function deletePlaylist(token: string, id: number) {
  return requestJson<{ deleted: boolean }>(
    `/playlists/${id}`,
    { method: "DELETE" },
    token,
  );
}

export function addPlaylistFeedback(
  token: string,
  playlistId: number,
  body: string,
) {
  return requestJson<PlaylistFeedback>(
    `/playlists/${playlistId}/feedback`,
    { method: "POST", body: JSON.stringify({ rating: 5, body }) },
    token,
  );
}

export function askRag(query: string): Promise<RagResponse> {
  return requestJson<RagResponse>("/ai/rag/recommend", {
    method: "POST",
    body: JSON.stringify({ query, limit: 5 }),
  });
}

export function askMcp(
  input: string | { query?: string; url?: string; limit?: number },
): Promise<McpResponse> {
  const body =
    typeof input === "string"
      ? { query: input }
      : {
          ...input,
        };

  return requestJson<McpResponse>("/ai/mcp/youtube", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function askAgent(goal: string): Promise<AgentResponse> {
  return requestJson<AgentResponse>("/ai/agent/study-plan", {
    method: "POST",
    body: JSON.stringify({
      goal,
      language: "ko",
      interests: ["youtube", "study"],
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
  startSeconds?: number;
  endSeconds?: number;
}): Promise<CaptionResponse> {
  return requestJson<CaptionResponse>("/ai/youtube/captions", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      targetLanguage: input.targetLanguage ?? "ko",
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
  return requestJson<VideoSummaryResponse>("/ai/youtube/summary", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      language: "ko",
    }),
  });
}
