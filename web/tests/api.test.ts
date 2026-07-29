import assert from "node:assert/strict";
import test from "node:test";
import {
  completeRegistration,
  consumeEmailVerification,
  fetchRegistrationReadiness,
  logout,
  requestJson,
  resendEmailVerification,
  setUnauthorizedHandler,
  signUp,
} from "../src/api.ts";

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
    new Response(JSON.stringify({ message: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  try {
    await assert.rejects(requestJson("/me"), /Authentication required/);
    assert.equal(unauthorized, 1);
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
