import assert from "node:assert/strict";
import test from "node:test";
import {
  approveLearningProposal,
  askAgent,
  captureLiveCaptionChunk,
  completeRegistration,
  consumeEmailVerification,
  dismissLearningProposal,
  fetchRegistrationReadiness,
  finalizeLiveCaptions,
  logout,
  requestJson,
  resendEmailVerification,
  setUnauthorizedHandler,
  signUp,
  updateMe,
  verifyMe,
} from "../src/api.ts";

test("sends recent learning and exclusions to the Course agent", async () => {
  const requestAgent = askAgent as unknown as (
    goal: string,
    interests: string[],
    recommendationContext: {
      subject: string;
      pace: string;
      learningGoal: string;
      interests: string[];
      excludedVideoIds: string[];
      recentVideos: Array<{
        videoId: string;
        title: string;
        channel: string;
        completed: boolean;
      }>;
    },
  ) => Promise<unknown>;
  const recommendationContext = {
    subject: "C++",
    pace: "하루 20분",
    learningGoal: "기초부터 이해하기",
    interests: ["프로그래밍"],
    excludedVideoIds: ["abc123DEF45"],
    recentVideos: [
      {
        videoId: "abc123DEF45",
        title: "C++ 변수 기초",
        channel: "코딩 교실",
        completed: false,
      },
    ],
  };

  const request = await captureRequest(
    () => requestAgent("배울 내용: C++", ["프로그래밍"], recommendationContext),
    { recommendations: [] },
  );

  assert.match(request.input, /\/ai\/agent\/study-plan$/);
  assert.deepEqual(JSON.parse(String(request.init?.body)), {
    goal: "배울 내용: C++",
    language: "ko",
    interests: ["프로그래밍"],
    recommendationContext,
  });
});

test("uploads and finalizes captured captions through authenticated endpoints", async () => {
  const chunk = await captureRequest(
    () =>
      captureLiveCaptionChunk({
        contextId: "42",
        sessionId: "15ed31b7-0951-4ccb-b878-494ed3c3954f",
        ordinal: 0,
        startSeconds: 12,
        endSeconds: 20,
        mimeType: "audio/webm;codecs=opus",
        audioBase64: "dGVzdA==",
      }),
    { source: "hello", korean: "안녕하세요" },
  );

  assert.match(chunk.input, /\/ai\/live-captions\/chunks$/);
  assert.equal(chunk.init?.method, "POST");

  const finalize = await captureRequest(
    () =>
      finalizeLiveCaptions({
        contextId: "42",
        sessionId: "15ed31b7-0951-4ccb-b878-494ed3c3954f",
      }),
    { status: "ready" },
  );
  assert.match(finalize.input, /\/ai\/live-captions\/finalize$/);
  assert.equal(finalize.init?.method, "POST");
});

test("uses the browser cookie for protected requests without an authorization header", async () => {
  const originalFetch = globalThis.fetch;
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await requestJson("/me");

    assert.equal(captured?.credentials, "include");
    const headers = new Headers(captured?.headers);
    assert.equal(headers.has("Authorization"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not invent a bearer header when callers add request headers", async () => {
  const originalFetch = globalThis.fetch;
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await requestJson("/courses", {
      headers: { "Idempotency-Key": "user-7:draft-2:revision-4" },
    });

    const headers = new Headers(captured?.headers);
    assert.equal(headers.get("Idempotency-Key"), "user-7:draft-2:revision-4");
    assert.equal(headers.has("Authorization"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notifies the session boundary after a protected request returns 401", async () => {
  const originalFetch = globalThis.fetch;
  let unauthorized = 0;
  setUnauthorizedHandler(() => {
    unauthorized += 1;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    await assert.rejects(requestJson("/me"), /로그인이 필요합니다/);
    assert.equal(unauthorized, 1);
  } finally {
    setUnauthorizedHandler(null);
    globalThis.fetch = originalFetch;
  }
});

test("does not expose raw English API errors to Korean users", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Cannot PUT /me" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });

  try {
    await assert.rejects(
      requestJson("/me", { method: "PUT" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /요청한 기능을 찾을 수 없습니다/);
        assert.doesNotMatch(error.message, /Cannot PUT|Not Found|API 404/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explains a learning daily limit without calling it a service outage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: "LEARNING_DAILY_LIMIT_REACHED",
        message: "Provider budget unavailable",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    await assert.rejects(requestJson("/learning/items/intake"), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "오늘 준비할 수 있는 자막 분량을 모두 사용했습니다. 이미 등록한 영상으로 학습하거나 내일 다시 시도해주세요.",
      );
      assert.doesNotMatch(error.message, /서비스가.*불안정/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps the session when only the current password is wrong", async () => {
  const originalFetch = globalThis.fetch;
  let unauthorized = 0;
  setUnauthorizedHandler(() => {
    unauthorized += 1;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: "INVALID_CURRENT_PASSWORD",
        message: "Current password is invalid",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    await assert.rejects(
      verifyMe({ currentPassword: "wrong password" }),
      /현재 비밀번호가 올바르지 않습니다/,
    );
    assert.equal(unauthorized, 0);
  } finally {
    setUnauthorizedHandler(null);
    globalThis.fetch = originalFetch;
  }
});

test("logs out through the cookie session endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(null, { status: 204 });
  };

  try {
    await logout();
    assert.match(request?.input ?? "", /\/auth\/logout$/);
    assert.equal(request?.init?.method, "POST");
    assert.equal(request?.init?.credentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("starts registration with only an email address", async () => {
  const request = await captureRequest(
    () => signUp({ email: "ada@example.com" }),
    { status: "accepted" },
  );

  assert.match(request.input, /\/auth\/signup$/);
  assert.equal(request.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init?.body)), {
    email: "ada@example.com",
  });
});

test("resends verification for the saved email through the dedicated endpoint", async () => {
  const request = await captureRequest(
    () => resendEmailVerification({ email: "ada@example.com" }),
    { status: "accepted" },
    202,
  );

  assert.match(request.input, /\/auth\/email-verifications\/resend$/);
  assert.equal(request.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init?.body)), {
    email: "ada@example.com",
  });
});

test("consumes the verification token without exposing an enrollment token", async () => {
  const request = await captureRequest(
    () => consumeEmailVerification("v1.pending.secret"),
    undefined,
    204,
  );

  assert.match(request.input, /\/auth\/email-verifications\/consume$/);
  assert.equal(request.init?.method, "POST");
  // Synthetic versioned token fixture: this only verifies request serialization.
  assert.deepEqual(JSON.parse(String(request.init?.body)), {
    verificationToken: "v1.pending.secret",
  });
});

test("checks the HttpOnly enrollment cookie before rendering completion", async () => {
  const request = await captureRequest(() => fetchRegistrationReadiness(), {
    status: "ready",
  });

  assert.match(request.input, /\/auth\/registrations\/current$/);
  assert.equal(request.init?.method, undefined);
  assert.equal(request.init?.credentials, "include");
  assert.equal(request.init?.body, undefined);
});

test("completes registration with name and password only", async () => {
  const request = await captureRequest(
    () => completeRegistration({ name: "Ada", password: "correct horse" }),
    { user: { id: 1, name: "Ada" } },
  );

  assert.match(request.input, /\/auth\/registrations\/complete$/);
  assert.equal(request.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init?.body)), {
    name: "Ada",
    password: "correct horse",
  });
});

test("verifies and updates the current profile through cookie endpoints", async () => {
  const verification = await captureRequest(
    () => verifyMe({ currentPassword: "current password" }),
    { id: 7, name: "Ada" },
  );

  assert.match(verification.input, /\/me\/verify$/);
  assert.equal(verification.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(verification.init?.body)), {
    currentPassword: "current password",
  });

  const update = await captureRequest(
    () =>
      updateMe({
        preferences: {
          interests: ["Docker"],
          pace: "10분",
          goal: "마스터하기",
        },
      }),
    { id: 7, name: "Ada" },
  );

  assert.match(update.input, /\/me$/);
  assert.equal(update.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(update.init?.body)), {
    preferences: {
      interests: ["Docker"],
      pace: "10분",
      goal: "마스터하기",
    },
  });
});

test("approves and dismisses learning proposals through requestJson", async () => {
  const approval = await captureRequest(
    () =>
      approveLearningProposal({
        proposalId: "proposal-7",
        targetKind: "existing_course",
        courseId: 11,
        expectedCourseVersion: 3,
      }),
    { id: "proposal-7", approvedCourseId: 11 },
  );

  assert.match(approval.input, /\/learning\/proposals\/approve$/);
  assert.equal(approval.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(approval.init?.body)), {
    proposalId: "proposal-7",
    targetKind: "existing_course",
    courseId: 11,
    expectedCourseVersion: 3,
  });

  const dismissal = await captureRequest(
    () => dismissLearningProposal("proposal-7"),
    { id: "proposal-7", state: "dismissed" },
  );
  assert.match(dismissal.input, /\/learning\/proposals\/proposal-7\/dismiss$/);
  assert.equal(dismissal.init?.method, "POST");
});

test("learning proposal actions retain localized unauthorized handling", async () => {
  const originalFetch = globalThis.fetch;
  let unauthorized = 0;
  setUnauthorizedHandler(() => {
    unauthorized += 1;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      dismissLearningProposal("proposal-7"),
      /로그인이 필요합니다/,
    );
    assert.equal(unauthorized, 1);
  } finally {
    setUnauthorizedHandler(null);
    globalThis.fetch = originalFetch;
  }
});

async function captureRequest(
  operation: () => Promise<unknown>,
  responseBody: unknown,
  status = 200,
): Promise<{ input: string; init?: RequestInit }> {
  const originalFetch = globalThis.fetch;
  let captured: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { input: String(input), init };
    return responseBody === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(responseBody), {
          status,
          headers: { "Content-Type": "application/json" },
        });
  };

  try {
    await operation();
    assert.ok(captured);
    return captured;
  } finally {
    globalThis.fetch = originalFetch;
  }
}
