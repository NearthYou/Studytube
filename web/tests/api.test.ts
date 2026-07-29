import assert from 'node:assert/strict';
import test from 'node:test';
import { logout, requestJson, setUnauthorizedHandler } from '../src/api.ts';

test('uses the browser cookie for protected requests without an authorization header', async () => {
  const originalFetch = globalThis.fetch;
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await requestJson('/me');

    assert.equal(captured?.credentials, 'include');
    const headers = new Headers(captured?.headers);
    assert.equal(headers.has('Authorization'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not invent a bearer header when callers add request headers', async () => {
  const originalFetch = globalThis.fetch;
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await requestJson('/courses', {
      headers: { 'Idempotency-Key': 'user-7:draft-2:revision-4' },
    });

    const headers = new Headers(captured?.headers);
    assert.equal(headers.get('Idempotency-Key'), 'user-7:draft-2:revision-4');
    assert.equal(headers.has('Authorization'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('notifies the session boundary after a protected request returns 401', async () => {
  const originalFetch = globalThis.fetch;
  let unauthorized = 0;
  setUnauthorizedHandler(() => {
    unauthorized += 1;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    await assert.rejects(requestJson('/me'), /Authentication required/);
    assert.equal(unauthorized, 1);
  } finally {
    setUnauthorizedHandler(null);
    globalThis.fetch = originalFetch;
  }
});

test('logs out through the cookie session endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(null, { status: 204 });
  };

  try {
    await logout();
    assert.match(request?.input ?? '', /\/auth\/logout$/);
    assert.equal(request?.init?.method, 'POST');
    assert.equal(request?.init?.credentials, 'include');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
