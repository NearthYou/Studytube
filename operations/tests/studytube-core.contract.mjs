import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workloadPath = resolve(testDirectory, '../load/studytube-core.js');
const passwordCanary = 'CANARY_password_not_retained';
const sessionCanary = 'CANARY_cookie_not_retained';
const emailCanary = 'CANARY_email_not_retained@example.com';
const sessionCookie = `__Host-studytube_session=${sessionCanary}`;
const readinessUrl = 'https://approved.example.com/api/health/live';
const baseEnvironment = {
  K6_BASE_URL: 'https://approved.example.com/api',
  K6_READINESS_URL: readinessUrl,
  K6_ACKNOWLEDGE_LOAD: 'true',
  K6_ACKNOWLEDGE_TARGET: 'https://approved.example.com/api',
  K6_LOGIN_EMAIL: emailCanary,
  K6_LOGIN_PASSWORD: passwordCanary,
  K6_SESSION_COOKIE: sessionCookie,
  K6_RUN_ID: 'load-contract',
};

const source = readFileSync(workloadPath, 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export const options =', 'const options =')
  .replace(/export default function\s*\(/, 'function defaultFlow(')
  .replace(/export function /g, 'function ');
const executable = `
  const http = globalThis.__test.http;
  const { check, fail, group, sleep, Rate } = globalThis.__test;
  ${source}
  globalThis.__workload = {
    options,
    setup,
    defaultFlow,
    teardown: typeof teardown === 'function' ? teardown : undefined,
    handleSummary,
  };
`;

function loadWorkload(environment, http) {
  const context = vm.createContext({
    __ENV: environment,
    __test: {
      http,
      check(value, predicates) {
        return Object.values(predicates).every((predicate) => predicate(value));
      },
      fail(message) {
        throw new Error(message);
      },
      group(_name, callback) {
        return callback();
      },
      sleep() {},
      Rate: class Rate {
        add() {}
      },
    },
  });
  vm.runInContext(executable, context, { filename: workloadPath });
  return context.__workload;
}

function recordingHttp(calls) {
  return {
    get(url, params = {}) {
      calls.push({ method: 'GET', url, params });
      return { status: 200, cookies: {} };
    },
    post(url, body, params = {}) {
      calls.push({ method: 'POST', url, body, params });
      if (url.endsWith('/auth/login')) {
        return {
          status: 200,
          cookies: {
            '__Host-studytube_session': [
              {
                name: '__Host-studytube_session',
                value: sessionCanary,
                domain: 'approved.example.com',
                path: '/',
                httpOnly: true,
                secure: true,
                maxAge: 3600,
                expires: 0,
              },
            ],
          },
        };
      }
      if (url.endsWith('/auth/logout')) {
        return { status: 204, cookies: {} };
      }
      throw new Error(`Unexpected POST ${url}`);
    },
  };
}

const calls = [];
const workload = loadWorkload(baseEnvironment, recordingHttp(calls));
const setupData = workload.setup();
const virtualUsers = [
  loadWorkload(baseEnvironment, recordingHttp(calls)),
  loadWorkload(baseEnvironment, recordingHttp(calls)),
];
for (const virtualUser of virtualUsers) {
  virtualUser.defaultFlow(setupData);
  virtualUser.defaultFlow(setupData);
}
if (workload.teardown) {
  workload.teardown(setupData);
}

const readinessCalls = calls.filter((call) => call.method === 'GET' && call.params.tags?.flow === 'readiness');
assert.equal(readinessCalls.length, 1, 'readiness must be checked once during setup');
assert.equal(readinessCalls[0].url, readinessUrl, 'setup must use K6_READINESS_URL');

const authenticatedCalls = calls.filter(
  (call) => call.method === 'GET' && ['posts', 'courses', 'search'].includes(call.params.tags?.flow),
);
assert.equal(authenticatedCalls.length, 12, 'both isolated VUs must execute two complete authenticated iterations');
for (const call of authenticatedCalls) {
  assert.equal(
    call.params.headers?.Cookie,
    sessionCookie,
    'each VU iteration must reuse the pre-provisioned session without relying on a setup cookie jar',
  );
}

const setupText = JSON.stringify(setupData);
const authenticationMutations = calls.filter(
  (call) => call.method === 'POST' && /\/auth\/(?:login|logout)$/.test(call.url),
);
assert.deepEqual(
  {
    authenticationMutationCount: authenticationMutations.length,
    setupRetainsCookie: setupText.includes(sessionCanary),
    setupRetainsEmail: setupText.includes(emailCanary),
    setupRetainsPassword: setupText.includes(passwordCanary),
  },
  {
    authenticationMutationCount: 0,
    setupRetainsCookie: false,
    setupRetainsEmail: false,
    setupRetainsPassword: false,
  },
  'the workload must not log in per VU or expose credentials through setup data',
);

const summary = workload.handleSummary({
  metrics: {
    checks: {
      values: { rate: 1, passes: 10, fails: 0 },
      thresholds: { 'rate>0.99': { ok: true } },
    },
  },
});
const evidenceText = summary.stdout;
const evidence = JSON.parse(evidenceText);
for (const canary of [passwordCanary, sessionCanary, emailCanary]) {
  assert.equal(evidenceText.includes(canary), false, `evidence must not retain ${canary}`);
}
assert.equal(evidence.configuration.authentication, 'preprovisioned-session');
assert.equal(evidence.configuration.readinessUrl, readinessUrl);
assert.deepEqual(
  evidence.retention,
  {
    credentialsRetained: false,
    responseBodiesRetained: false,
    cookiesRetained: false,
  },
  'the evidence retention contract must remain unchanged',
);

for (const invalidCookie of [
  'unrelated_session=value',
  '__Host-studytube_session=value\r\nInjected: true',
  '__Host-studytube_session=value\r\n',
]) {
  const invalidWorkload = loadWorkload(
    { ...baseEnvironment, K6_SESSION_COOKIE: invalidCookie },
    recordingHttp([]),
  );
  let error;
  try {
    invalidWorkload.setup();
  } catch (caught) {
    error = caught;
  }
  assert.match(String(error), /K6_SESSION_COOKIE/, 'invalid session cookies must be rejected');
  assert.equal(String(error).includes(invalidCookie), false, 'validation errors must not echo the cookie value');
}

console.log('k6 workload contract passed: readiness, pre-provisioned session reuse, and evidence retention.');
