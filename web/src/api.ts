import type {
  AgentResponse,
  CaptionResponse,
  Comment as StudyComment,
  McpResponse,
  PaginatedPosts,
  RagResponse,
  Session,
  StudyPost,
  LearningNote,
  LearningCaptionSnapshotResponse,
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
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    throw new ApiRequestError(
      0,
      "서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
    );
  }

  if (!response.ok) {
    let code: string | undefined;
    let serverMessage: string | undefined;

    try {
      const errorBody = (await response.json()) as {
        code?: string;
        error?: string;
        message?: string | string[];
      };
      const bodyMessage = Array.isArray(errorBody.message)
        ? errorBody.message.join(" ")
        : errorBody.message;
      code = errorBody.code;
      serverMessage = bodyMessage || errorBody.error;
    } catch {
      // The Korean status fallback below is safe for non-JSON proxy errors.
    }

    if (response.status === 401 && code === "UNAUTHORIZED") {
      unauthorizedHandler?.();
    }

    throw new ApiRequestError(
      response.status,
      localizedApiError(response.status, code, serverMessage),
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function localizedApiError(
  status: number,
  code?: string,
  serverMessage?: string,
): string {
  if (/Password must be 8 to 128 UTF-8 bytes/i.test(serverMessage ?? "")) {
    return "비밀번호는 8~128바이트로 입력해주세요.";
  }
  if (
    /Password must not contain control characters/i.test(serverMessage ?? "")
  ) {
    return "비밀번호에는 제어 문자를 사용할 수 없습니다.";
  }

  const codeMessages: Record<string, string> = {
    INVALID_CREDENTIALS: "이메일 또는 비밀번호가 올바르지 않습니다.",
    INVALID_CURRENT_PASSWORD: "현재 비밀번호가 올바르지 않습니다.",
    INVALID_ENROLLMENT:
      "가입 세션이 없거나 만료되었습니다. 이메일 인증부터 다시 시작해주세요.",
    INVALID_PROFILE_UPDATE: "수정할 계정 정보를 확인해주세요.",
    INVALID_REQUEST: "입력값을 확인해주세요.",
    INVALID_YOUTUBE_URL: "지원되는 YouTube 주소를 입력해주세요.",
    INVALID_VERIFICATION: "인증 링크가 유효하지 않거나 만료되었습니다.",
    PROFILE_NOT_FOUND: "계정 정보를 찾을 수 없습니다.",
    RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    REGISTRATION_CONFLICT:
      "이미 처리된 가입 요청입니다. 이메일 인증부터 다시 시작해주세요.",
    SERVICE_UNAVAILABLE:
      "서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.",
    PROVIDER_BUDGET_UNAVAILABLE:
      "현재 영상 처리를 시작할 수 없습니다. 잠시 후 다시 시도해주세요.",
    UNAUTHORIZED: "로그인이 필요합니다.",
  };
  if (code && codeMessages[code]) {
    return codeMessages[code];
  }

  const statusMessages: Record<number, string> = {
    400: "입력값을 확인해주세요.",
    401: "로그인이 필요합니다.",
    403: "이 작업을 수행할 권한이 없습니다.",
    404: "요청한 기능을 찾을 수 없습니다.",
    409: "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해주세요.",
    429: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    500: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
    502: "서버 연결이 원활하지 않습니다. 잠시 후 다시 시도해주세요.",
    503: "서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.",
    504: "서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해주세요.",
  };
  return (
    statusMessages[status] ??
    "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요."
  );
}

export function apiBaseUrl() {
  return API_BASE_URL;
}

export function signUp(input: {
  email: string;
}): Promise<{ status: "accepted" }> {
  return requestJson<{ status: "accepted" }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resendEmailVerification(input: {
  email: string;
}): Promise<{ status: "accepted" }> {
  return requestJson<{ status: "accepted" }>(
    "/auth/email-verifications/resend",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function consumeEmailVerification(verificationToken: string) {
  return requestJson<void>("/auth/email-verifications/consume", {
    method: "POST",
    body: JSON.stringify({ verificationToken }),
  });
}

export function fetchRegistrationReadiness(): Promise<{ status: "ready" }> {
  return requestJson<{ status: "ready" }>("/auth/registrations/current");
}

export function completeRegistration(input: {
  name: string;
  password: string;
}): Promise<Session> {
  return requestJson<Session>("/auth/registrations/complete", {
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

export function verifyMe(input: { currentPassword: string }): Promise<User> {
  return requestJson<User>("/me/verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMe(input: {
  currentPassword?: string;
  name?: string;
  password?: string;
  preferences?: {
    interests: string[];
    pace: string;
    goal: string;
  };
}): Promise<User> {
  return requestJson<User>("/me", {
    method: "PUT",
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

export function createPost(input: {
  title: string;
  videoUrl: string;
  thumbnailUrl?: string;
  channelName: string;
  summary: string;
  translatedNotes: string;
  tags: string[];
}): Promise<StudyPost> {
  return requestJson<StudyPost>("/posts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePost(
  id: number,
  input: Partial<StudyPost>,
): Promise<StudyPost> {
  return requestJson<StudyPost>(`/posts/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deletePost(id: number) {
  return requestJson<{ deleted: boolean }>(`/posts/${id}`, {
    method: "DELETE",
  });
}

export function addComment(postId: number, body: string) {
  return requestJson<StudyComment>(`/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function deleteComment(postId: number, commentId: number) {
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

export function createLearningNote(input: {
  contextId: string;
  positionSeconds: number;
  body: string;
}): Promise<LearningNote> {
  return requestJson<LearningNote>(
    `/learning/contexts/${input.contextId}/notes`,
    {
      method: "POST",
      body: JSON.stringify({
        positionSeconds: input.positionSeconds,
        body: input.body,
      }),
    },
  );
}

export function fetchLearningCaptions(
  contextId: string,
): Promise<LearningCaptionSnapshotResponse> {
  return requestJson<LearningCaptionSnapshotResponse>(
    `/learning/contexts/${contextId}/captions`,
  );
}

export function updateLearningNote(input: {
  contextId: string;
  noteId: string;
  body: string;
}): Promise<LearningNote> {
  return requestJson<LearningNote>(
    `/learning/contexts/${input.contextId}/notes/${input.noteId}`,
    { method: "PATCH", body: JSON.stringify({ body: input.body }) },
  );
}

export function deleteLearningNote(input: {
  contextId: string;
  noteId: string;
}): Promise<{ deleted: true }> {
  return requestJson<{ deleted: true }>(
    `/learning/contexts/${input.contextId}/notes/${input.noteId}`,
    { method: "DELETE" },
  );
}

export type AdaptiveQuizLoop = {
  id: string;
  studyContextId: string;
  state: "generating" | "ready" | "evaluated" | "failed" | "stale";
  watchedRange: { start: number; end: number };
  captionArtifactId: string;
  captionGeneration: number;
  questions: Array<{
    id: string;
    position: number;
    prompt: string;
    choices: string[];
    citation: {
      resourceId: string;
      sourceUrl: string;
      startSeconds: number;
      endSeconds: number;
      artifactId: string;
      artifactGeneration: number;
    };
  }>;
  failureCode: string | null;
};

export type AdaptiveQuizSubmission = {
  state: "evaluated";
  attempt: {
    id: string;
    score: number;
    submittedAt: string;
    answers: Array<{
      questionId: string;
      selectedChoiceIndex: number;
      correct: boolean;
      correctChoiceIndex: number;
      explanation: string;
      citation: AdaptiveQuizLoop["questions"][number]["citation"];
    }>;
  };
  reviewProposal: null | {
    kind: "review_range";
    reasonCode: "INCORRECT_ANSWER";
    citation: {
      sourceUrl: string;
      startSeconds: number;
      endSeconds: number;
    };
  };
};

export function requestAdaptiveQuiz(input: {
  contextId: string;
  startSeconds: number;
  endSeconds: number;
  idempotencyKey: string;
}): Promise<AdaptiveQuizLoop> {
  return requestJson<AdaptiveQuizLoop>(
    `/learning/contexts/${input.contextId}/quiz-loops`,
    {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        startSeconds: input.startSeconds,
        endSeconds: input.endSeconds,
      }),
    },
  );
}

export function fetchAdaptiveQuiz(loopId: string): Promise<AdaptiveQuizLoop> {
  return requestJson<AdaptiveQuizLoop>(`/learning/quiz-loops/${loopId}`);
}

export function submitAdaptiveQuiz(input: {
  loopId: string;
  idempotencyKey: string;
  answers: Array<{ questionId: string; selectedChoiceIndex: number }>;
}): Promise<AdaptiveQuizSubmission> {
  return requestJson<AdaptiveQuizSubmission>(
    `/learning/quiz-loops/${input.loopId}/submit`,
    {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ answers: input.answers }),
    },
  );
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
