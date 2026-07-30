import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workloadPath = resolve(testDirectory, '../load/studytube-progress-write.js');
const sessionCanary = 'CANARY_write_cookie_not_retained';
const stepCanary = '918273645';
const responseCanary = 'CANARY_response_body_not_retained';
const sessionCookie = `__Host-studytube_session=${sessionCanary}`;
const baseEnvironment = {
  K6_BASE_URL: 'https://approved.example.com/api',
  K6_READINESS_URL: 'https://approved.example.com/api/health/live',
  K6_ACKNOWLEDGE_WRITES: 'true',
  K6_ACKNOWLEDGE_TARGET: 'https://approved.example.com/api',
  K6_ACKNOWLEDGE_DEDICATED_DATA: 'true',
  K6_SESSION_COOKIE: sessionCookie,
  K6_COURSE_STEP_ID: stepCanary,
  K6_ACKNOWLEDGE_COURSE_STEP_ID: stepCanary,
  STUDYTUBE_K6_RUN_ID: 'progress-contract',
  K6_WRITE_VUS: '4',
  K6_WRITE_ITERATIONS: '1',
};

const source = readFileSync(workloadPath, 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export const options =', 'const options =')
  .replace(/export default function\s*\(/, 'function defaultFlow(')
  .replace(/export function /g, 'function ');
const executable = `
  const http = globalThis.__test.http;
  const exec = globalThis.__test.exec;
  const { check, fail, Rate, Trend } = globalThis.__test;
  ${source}
  globalThis.__workload = { options, setup, defaultFlow, teardown, handleSummary };
`;

function configuredExecutionOptions(environment, overrides = {}) {
  const vus = Number(environment.K6_WRITE_VUS || 4);
  const iterations = Number(environment.K6_WRITE_ITERATIONS || 1);
  return {
    scenarios: {
      progress_write: {
        executor: 'per-vu-iterations',
        startTime: null,
        gracefulStop: '15s',
        env: null,
        exec: null,
        tags: null,
        vus,
        iterations,
        maxDuration: '2m0s',
      },
    },
    noSetup: null,
    noTeardown: null,
    executionSegment: null,
    executionSegmentSequence: null,
    insecureSkipTLSVerify: null,
    httpDebug: null,
    hosts: null,
    discardResponseBodies: true,
    maxRedirects: 0,
    systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
    summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
    ...overrides,
  };
}

function loadWorkload(
  environment,
  http,
  virtualUserId = 1,
  iteration = 0,
  executionOptions = configuredExecutionOptions(environment),
) {
  const context = vm.createContext({
    __ENV: environment,
    __VU: virtualUserId,
    __ITER: iteration,
    __test: {
      http,
      exec: { test: { options: executionOptions } },
      check(value, predicates) {
        return Object.values(predicates).every((predicate) => predicate(value));
      },
      fail(message) {
        throw new Error(message);
      },
      Rate: class Rate {
        add() {}
      },
      Trend: class Trend {
        add() {}
      },
    },
  });
  vm.runInContext(executable, context, { filename: workloadPath });
  return context.__workload;
}

function recordingHttp(calls, { mutateDuplicates = false } = {}) {
  const ranges = [];
  const seenKeys = new Set();
  let version = 40;
  return {
    expectedStatuses(...statuses) {
      return { statuses };
    },
    get(url, params = {}) {
      calls.push({ method: 'GET', url, params });
      if (params.tags?.flow === 'progress_readback') {
        return {
          status: 200,
          timings: { duration: 9 },
          body: JSON.stringify({ watchedRanges: ranges, version, responseCanary }),
        };
      }
      if (params.tags?.flow === 'progress_baseline' || params.tags?.flow === 'progress_version_contract') {
        return {
          status: 200,
          timings: { duration: 5 },
          body: JSON.stringify({ watchedRanges: ranges, version, responseCanary }),
        };
      }
      return { status: 200, timings: { duration: 3 }, body: '' };
    },
    post(url, body, params = {}) {
      calls.push({ method: 'POST', url, body, params });
      const parsed = JSON.parse(body);
      const idempotencyKey = params.headers['Idempotency-Key'];
      if (!seenKeys.has(idempotencyKey) || mutateDuplicates) {
        ranges.push({ start: parsed.startSeconds, end: parsed.endSeconds });
        version += 1;
      }
      seenKeys.add(idempotencyKey);
      return {
        status: 200,
        timings: { duration: params.tags?.flow === 'progress_duplicate' ? 7 : 11 },
        body: JSON.stringify({ version, responseCanary }),
      };
    },
  };
}

const calls = [];
const http = recordingHttp(calls);
const setupWorkload = loadWorkload(baseEnvironment, http);
const setupData = setupWorkload.setup();
assert.equal(setupWorkload.options.scenarios.progress_write.executor, 'per-vu-iterations');
assert.equal(setupWorkload.options.scenarios.progress_write.vus, 4);
assert.equal(setupWorkload.options.scenarios.progress_write.iterations, 1);

for (let virtualUserId = 1; virtualUserId <= 4; virtualUserId += 1) {
  loadWorkload(baseEnvironment, http, virtualUserId, 0).defaultFlow(setupData);
}
setupWorkload.teardown(setupData);

const progressPosts = calls.filter((call) => call.method === 'POST');
assert.equal(progressPosts.length, 8, 'each VU must send one write and one exact duplicate');
for (let index = 0; index < progressPosts.length; index += 2) {
  const first = progressPosts[index];
  const duplicate = progressPosts[index + 1];
  assert.equal(first.url, `https://approved.example.com/api/learning/course-steps/${stepCanary}/progress`);
  assert.equal(first.url, duplicate.url);
  assert.equal(first.body, duplicate.body, 'duplicate payload must be byte-identical');
  assert.equal(
    first.params.headers['Idempotency-Key'],
    duplicate.params.headers['Idempotency-Key'],
    'duplicate request must reuse the same idempotency key',
  );
  assert.match(first.params.headers['Idempotency-Key'], /^progress-contract-v\d+-i0$/);
  assert.equal(first.params.headers.Cookie, sessionCookie);
}

const readbacks = calls.filter(
  (call) => call.method === 'GET' && call.params.tags?.flow === 'progress_readback',
);
assert.equal(readbacks.length, 4, 'each VU must verify its own progress range');
for (const call of calls.filter((item) => item.params?.headers?.Cookie)) {
  assert.equal(call.params.redirects, 0, 'authenticated requests must never follow redirects');
  assert.equal(call.params.tags.name.includes(stepCanary), false, 'metric names must not retain raw step IDs');
}
for (const call of calls) {
  assert.equal(call.params.timeout, '5s', 'every k6 HTTP request must have the fixed short timeout');
}

const summary = setupWorkload.handleSummary({
  metrics: {
    checks: {
      values: { rate: 1, passes: 20, fails: 0 },
      thresholds: { 'rate>0.99': { ok: true } },
    },
    progress_flow_errors: {
      values: { rate: 0, passes: 0, fails: 13 },
      thresholds: { 'rate<0.01': { ok: true } },
    },
    progress_guard_errors: {
      values: { rate: 0, passes: 0, fails: 1 },
      thresholds: { 'rate==0': { ok: true } },
    },
    progress_version_errors: {
      values: { rate: 0, passes: 0, fails: 1 },
      thresholds: { 'rate==0': { ok: true } },
    },
    http_req_failed: {
      values: { rate: 0, passes: 0, fails: 15 },
      thresholds: { 'rate<0.01': { ok: true } },
    },
    http_reqs: { values: { count: 15, rate: 15 } },
    progress_write: {
      values: { med: 11, 'p(95)': 11, 'p(99)': 11, avg: 11, max: 11, count: 4 },
      thresholds: { 'p(95)<1000': { ok: true }, 'p(99)<2000': { ok: true } },
    },
    progress_duplicate: {
      values: { med: 7, 'p(95)': 7, 'p(99)': 7, avg: 7, max: 7, count: 4 },
      thresholds: { 'p(95)<1000': { ok: true }, 'p(99)<2000': { ok: true } },
    },
    progress_readback: {
      values: { med: 9, 'p(95)': 9, 'p(99)': 9, avg: 9, max: 9, count: 4 },
      thresholds: { 'p(95)<1000': { ok: true }, 'p(99)<2000': { ok: true } },
    },
  },
});
const evidenceText = summary.stdout;
const evidence = JSON.parse(evidenceText);
for (const canary of [sessionCanary, sessionCookie, stepCanary, responseCanary]) {
  assert.equal(evidenceText.includes(canary), false, `evidence must not retain ${canary}`);
}
assert.equal(evidence.configuration.profile, 'dedicated-progress-write');
assert.equal(evidence.configuration.dedicatedCourseStepConfigured, true);
assert.equal(evidence.status, 'passed');
assert.deepEqual(
  evidence.retention,
  {
    credentialsRetained: false,
    responseBodiesRetained: false,
    rawDataIdentifiersRetained: false,
  },
);

const incompleteEvidence = JSON.parse(
  setupWorkload.handleSummary({
    metrics: {
      checks: {
        values: { rate: 1, passes: 1, fails: 0 },
        thresholds: { 'rate>0.99': { ok: true } },
      },
    },
  }).stdout,
);
assert.equal(incompleteEvidence.status, 'failed', 'missing required metrics must fail the evidence');

const shortStepCalls = [];
const shortStepHttp = recordingHttp(shortStepCalls);
const shortStepEnvironment = {
  ...baseEnvironment,
  STUDYTUBE_K6_RUN_ID: 'one-second-step-contract',
  K6_WRITE_ITERATIONS: '3',
};
const shortStepWorkload = loadWorkload(shortStepEnvironment, shortStepHttp);
const shortStepSetupData = shortStepWorkload.setup();
for (let virtualUserId = 1; virtualUserId <= 4; virtualUserId += 1) {
  for (let iteration = 0; iteration < 3; iteration += 1) {
    loadWorkload(shortStepEnvironment, shortStepHttp, virtualUserId, iteration).defaultFlow(
      shortStepSetupData,
    );
  }
}
shortStepWorkload.teardown(shortStepSetupData);
const shortStepUniqueRanges = new Set();
for (const call of shortStepCalls.filter(
  (item) => item.method === 'POST' && item.params.tags?.flow === 'progress_write',
)) {
  const payload = JSON.parse(call.body);
  assert.ok(payload.startSeconds >= 0, 'a progress range must not start before the step');
  assert.ok(payload.endSeconds <= 1, 'all ranges must fit inside a valid one-second step');
  assert.ok(payload.endSeconds > payload.startSeconds, 'each progress range must have positive duration');
  shortStepUniqueRanges.add(`${payload.startSeconds}:${payload.endSeconds}`);
}
assert.equal(
  shortStepUniqueRanges.size,
  12,
  'the maximum bounded plan must give every unique write its own one-second-step range',
);

const mutatingDuplicateCalls = [];
const mutatingDuplicateHttp = recordingHttp(mutatingDuplicateCalls, { mutateDuplicates: true });
const mutatingEnvironment = { ...baseEnvironment, STUDYTUBE_K6_RUN_ID: 'duplicate-mutation-contract' };
const mutatingWorkload = loadWorkload(mutatingEnvironment, mutatingDuplicateHttp);
const mutatingSetupData = mutatingWorkload.setup();
for (let virtualUserId = 1; virtualUserId <= 4; virtualUserId += 1) {
  loadWorkload(mutatingEnvironment, mutatingDuplicateHttp, virtualUserId, 0).defaultFlow(mutatingSetupData);
}
let mutatingDuplicateError;
try {
  mutatingWorkload.teardown(mutatingSetupData);
} catch (caught) {
  mutatingDuplicateError = caught;
}
assert.match(
  String(mutatingDuplicateError),
  /idempotency/i,
  'a server that applies duplicate requests as new mutations must fail the run-level version contract',
);

function assertRejected(environment, pattern, secretValue) {
  let error;
  try {
    loadWorkload(environment, recordingHttp([])).setup();
  } catch (caught) {
    error = caught;
  }
  assert.match(String(error), pattern);
  if (secretValue) {
    assert.equal(String(error).includes(secretValue), false, 'validation errors must not echo sensitive input');
  }
}

assertRejected({ ...baseEnvironment, K6_ACKNOWLEDGE_WRITES: '' }, /K6_ACKNOWLEDGE_WRITES/);
assertRejected({ ...baseEnvironment, K6_ACKNOWLEDGE_TARGET: 'https://other.example.com/api' }, /K6_ACKNOWLEDGE_TARGET/);
assertRejected({ ...baseEnvironment, K6_ACKNOWLEDGE_DEDICATED_DATA: '' }, /K6_ACKNOWLEDGE_DEDICATED_DATA/);
assertRejected({ ...baseEnvironment, K6_ACKNOWLEDGE_COURSE_STEP_ID: '1' }, /K6_ACKNOWLEDGE_COURSE_STEP_ID/, stepCanary);
assertRejected({ ...baseEnvironment, K6_SESSION_COOKIE: 'unsafe-cookie' }, /K6_SESSION_COOKIE/, 'unsafe-cookie');
assertRejected({ ...baseEnvironment, K6_WRITE_VUS: '5' }, /K6_WRITE_VUS/);
assertRejected({ ...baseEnvironment, STUDYTUBE_K6_RUN_ID: '../escape' }, /STUDYTUBE_K6_RUN_ID/);
assertRejected({ ...baseEnvironment, STUDYTUBE_K6_RUN_ID: '' }, /STUDYTUBE_K6_RUN_ID/);
assertRejected(
  {
    ...baseEnvironment,
    K6_BASE_URL: 'http://approved.example.com/api',
    K6_READINESS_URL: 'http://approved.example.com/api/health/live',
    K6_ACKNOWLEDGE_TARGET: 'http://approved.example.com/api',
  },
  /HTTPS/,
);

function assertExecutionRejected(executionOptions, phase) {
  const rejectedCalls = [];
  const rejectedWorkload = loadWorkload(
    baseEnvironment,
    recordingHttp(rejectedCalls),
    1,
    0,
    executionOptions,
  );
  let error;
  try {
    if (phase === 'default') {
      rejectedWorkload.defaultFlow(undefined);
    } else {
      rejectedWorkload.setup();
    }
  } catch (caught) {
    error = caught;
  }
  assert.match(
    String(error),
    /(execution plan|setup and teardown|guarded setup|HTTP debug|host resolution)/i,
  );
  assert.equal(rejectedCalls.length, 0, 'an unsafe execution override must be rejected before network access');
}

assertExecutionRejected(
  configuredExecutionOptions(baseEnvironment, {
    scenarios: { default: { executor: 'constant-vus', vus: 100, duration: '10m' } },
  }),
  'setup',
);
assertExecutionRejected(
  configuredExecutionOptions(baseEnvironment, { noSetup: true }),
  'default',
);
assertExecutionRejected(
  configuredExecutionOptions(baseEnvironment, { noTeardown: true }),
  'setup',
);
assertExecutionRejected(
  configuredExecutionOptions(baseEnvironment, { httpDebug: 'full' }),
  'setup',
);
assertExecutionRejected(
  configuredExecutionOptions(baseEnvironment, {
    hosts: { localhost: '203.0.113.5' },
  }),
  'setup',
);

console.log('k6 progress write contract passed: bounded writes, exact duplicate, and redacted evidence.');
