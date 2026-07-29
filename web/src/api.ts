import type {
  AgentResponse,
  CaptionResponse,
  Comment as StudyComment,
  McpResponse,
  PaginatedPosts,
  RagResponse,
  Session,
  StudyPost,
  User,
  VideoSummaryResponse,
} from "./types";

type BrowserLocation = Pick<Location, "hostname">;

const viteEnv = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env;

const API_BASE_URL = resolveApiBaseUrl(
  viteEnv?.VITE_API_BASE_URL,
  globalThis.location,
);

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export function resolveApiBaseUrl(
  configuredUrl?: string,
  currentLocation?: BrowserLocation,
) {
  const fallbackUrl =
    currentLocation && !isLocalHostname(currentLocation.hostname)
      ? "/api"
      : "http://localhost:3000";
  const normalizedUrl = configuredUrl?.trim().replace(/\/$/, "") || fallbackUrl;

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (
      currentLocation &&
      isLocalHostname(parsedUrl.hostname) &&
      !isLocalHostname(currentLocation.hostname)
    ) {
      return "/api";
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

export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      unauthorizedHandler?.();
    }
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

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function apiBaseUrl() {
  return API_BASE_URL;
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

export function logout() {
  return requestJson<void>("/auth/logout", {
    method: "POST",
  });
}

export function fetchMe(): Promise<User> {
  return requestJson<User>("/me");
}

export function verifyMe(
  input: {
    currentPassword: string;
  },
): Promise<User> {
  return requestJson<User>(
    "/me/verify",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateMe(
  input: {
    currentPassword?: string;
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
  );
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
    params.set("search", search.trim());
  }

  return requestJson<PaginatedPosts>(`/posts?${params.toString()}`);
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
  );
}

export function updatePost(
  id: number,
  input: Partial<StudyPost>,
): Promise<StudyPost> {
  return requestJson<StudyPost>(
    `/posts/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function deletePost(id: number) {
  return requestJson<{ deleted: boolean }>(
    `/posts/${id}`,
    { method: "DELETE" },
  );
}

export function addComment(postId: number, body: string) {
  return requestJson<StudyComment>(
    `/posts/${postId}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}

export function deleteComment(
  postId: number,
  commentId: number,
) {
  return requestJson<{ deleted: boolean }>(
    `/posts/${postId}/comments/${commentId}`,
    { method: "DELETE" },
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
