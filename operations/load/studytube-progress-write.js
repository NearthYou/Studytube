import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.K6_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const READINESS_URL = (__ENV.K6_READINESS_URL || `${BASE_URL}/health/live`).replace(/\/+$/, '');
const SESSION_COOKIE = __ENV.K6_SESSION_COOKIE || '';
const COURSE_STEP_ID = __ENV.K6_COURSE_STEP_ID || '';
const RUN_ID = __ENV.STUDYTUBE_K6_RUN_ID || '';
const sessionCookiePattern = /^(?:__Host-)?studytube_session=[^\s;]+$/;

function boundedInteger(name, value, fallback, minimum, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

if (!/^[A-Za-z0-9_-]{1,64}$/.test(RUN_ID)) {
  fail('STUDYTUBE_K6_RUN_ID must contain only letters, digits, underscores, or hyphens and be at most 64 characters.');
}

const WRITE_VUS = boundedInteger('K6_WRITE_VUS', __ENV.K6_WRITE_VUS, 4, 1, 4);
const WRITE_ITERATIONS = boundedInteger('K6_WRITE_ITERATIONS', __ENV.K6_WRITE_ITERATIONS, 1, 1, 3);
const REQUEST_TIMEOUT = '5s';
const EVIDENCE_PATH = `docs/evidence/operations/results/${RUN_ID}.json`;
const PROGRESS_URL = `${BASE_URL}/learning/course-steps/${COURSE_STEP_ID}/progress`;
const flowErrors = new Rate('progress_flow_errors');
const guardErrors = new Rate('progress_guard_errors');
const versionErrors = new Rate('progress_version_errors');
const writeDuration = new Trend('progress_write', true);
const duplicateDuration = new Trend('progress_duplicate', true);
const readbackDuration = new Trend('progress_readback', true);

export const options = {
  discardResponseBodies: true,
  maxRedirects: 0,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  scenarios: {
    progress_write: {
      executor: 'per-vu-iterations',
      vus: WRITE_VUS,
      iterations: WRITE_ITERATIONS,
      maxDuration: '2m',
      gracefulStop: '15s',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    progress_flow_errors: ['rate<0.01'],
    progress_guard_errors: ['rate==0'],
    progress_version_errors: ['rate==0'],
    http_req_failed: ['rate<0.01'],
    progress_write: ['p(95)<1000', 'p(99)<2000'],
    progress_duplicate: ['p(95)<1000', 'p(99)<2000'],
    progress_readback: ['p(95)<1000', 'p(99)<2000'],
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

function isLoopbackTarget(value) {
  const match = value.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
  if (!match || match[1].includes('@')) {
    return false;
  }
  const hostWithPort = match[1].toLowerCase();
  const host = hostWithPort.startsWith('[')
    ? hostWithPort.slice(0, hostWithPort.indexOf(']') + 1)
    : hostWithPort.split(':')[0];
  return ['127.0.0.1', 'localhost', '[::1]'].includes(host);
}

function targetAuthority(value) {
  const match = value.match(/^(https?):\/\/([^/?#]+)/i);
  return match ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}` : '';
}

function assertHttpTarget(value, name) {
  if (!/^https?:\/\//i.test(value) || value.includes('@') || /[?#]/.test(value)) {
    fail(`${name} must be an HTTP URL without credentials, query parameters, or fragments.`);
  }
}

function assertSafeConfiguration() {
  assertHttpTarget(BASE_URL, 'K6_BASE_URL');
  assertHttpTarget(READINESS_URL, 'K6_READINESS_URL');
  if (!isLoopbackTarget(BASE_URL) && !/^https:\/\//i.test(BASE_URL)) {
    fail('A non-loopback K6_BASE_URL must use HTTPS.');
  }
  if (!isLoopbackTarget(READINESS_URL) && !/^https:\/\//i.test(READINESS_URL)) {
    fail('A non-loopback K6_READINESS_URL must use HTTPS.');
  }
  if (__ENV.K6_ACKNOWLEDGE_WRITES !== 'true') {
    fail('Set K6_ACKNOWLEDGE_WRITES=true after confirming this test mutates dedicated progress data.');
  }
  if (!isLoopbackTarget(BASE_URL) && __ENV.K6_ACKNOWLEDGE_TARGET !== BASE_URL) {
    fail('For a non-loopback target, K6_ACKNOWLEDGE_TARGET must exactly match K6_BASE_URL.');
  }
  if (
    targetAuthority(READINESS_URL) !== targetAuthority(BASE_URL) &&
    !isLoopbackTarget(READINESS_URL) &&
    __ENV.K6_ACKNOWLEDGE_READINESS_TARGET !== READINESS_URL
  ) {
    fail('A readiness URL on another authority requires an exact K6_ACKNOWLEDGE_READINESS_TARGET match.');
  }
  if (__ENV.K6_ACKNOWLEDGE_DEDICATED_DATA !== 'true') {
    fail('Set K6_ACKNOWLEDGE_DEDICATED_DATA=true only for an isolated test session and course step.');
  }
  if (!/^[1-9]\d*$/.test(COURSE_STEP_ID)) {
    fail('K6_COURSE_STEP_ID must identify a pre-provisioned dedicated course step.');
  }
  if (__ENV.K6_ACKNOWLEDGE_COURSE_STEP_ID !== COURSE_STEP_ID) {
    fail('K6_ACKNOWLEDGE_COURSE_STEP_ID must exactly match the configured dedicated course step.');
  }
  if (!sessionCookiePattern.test(SESSION_COOKIE)) {
    fail('K6_SESSION_COOKIE must contain one dedicated StudyTube session cookie.');
  }
}

function assertExecutionPlan() {
  const testOptions = exec.test.options;
  const scenarios = testOptions.scenarios || {};
  const scenarioNames = Object.keys(scenarios);
  const scenario = scenarios.progress_write;
  if (
    scenarioNames.length !== 1 ||
    scenarioNames[0] !== 'progress_write' ||
    !scenario ||
    scenario.executor !== 'per-vu-iterations' ||
    scenario.vus !== WRITE_VUS ||
    scenario.iterations !== WRITE_ITERATIONS ||
    scenario.maxDuration !== '2m0s' ||
    scenario.gracefulStop !== '15s'
  ) {
    failExecutionGuard('Refusing an overridden k6 execution plan; run this script without VU, duration, iteration, or scenario overrides.');
  }
  if (testOptions.noSetup === true || testOptions.noTeardown === true) {
    failExecutionGuard('This write contract requires both setup and teardown.');
  }
  if (testOptions.executionSegment !== null || testOptions.executionSegmentSequence !== null) {
    failExecutionGuard('Distributed execution segments are not allowed for this bounded write contract.');
  }
  if (testOptions.insecureSkipTLSVerify === true) {
    failExecutionGuard('TLS verification must remain enabled for this write contract.');
  }
  if (testOptions.httpDebug !== null) {
    failExecutionGuard('HTTP debug output is forbidden because it can expose the dedicated session cookie.');
  }
  if (testOptions.hosts !== null) {
    failExecutionGuard('Custom host resolution is forbidden because it can bypass the acknowledged target.');
  }
  if (testOptions.discardResponseBodies !== true || testOptions.maxRedirects !== 0) {
    failExecutionGuard('Response body discard and redirect refusal cannot be overridden for this write contract.');
  }
  const requiredSystemTags = ['expected_response', 'method', 'name', 'scenario', 'status'];
  const actualSystemTags = Array.isArray(testOptions.systemTags)
    ? [...testOptions.systemTags].sort()
    : [];
  if (JSON.stringify(actualSystemTags) !== JSON.stringify(requiredSystemTags)) {
    failExecutionGuard('The bounded system tag set cannot be overridden for this write contract.');
  }
  const requiredTrendStats = ['avg', 'count', 'max', 'med', 'min', 'p(90)', 'p(95)', 'p(99)'];
  const actualTrendStats = Array.isArray(testOptions.summaryTrendStats)
    ? [...testOptions.summaryTrendStats].sort()
    : [];
  if (JSON.stringify(actualTrendStats) !== JSON.stringify(requiredTrendStats.sort())) {
    failExecutionGuard('The summary trend statistics cannot be overridden for this write contract.');
  }
}

function failExecutionGuard(message) {
  guardErrors.add(true, { guard: 'execution' });
  fail(message);
}

function requireSetupGuard(setupData) {
  if (
    !setupData ||
    setupData.guardVersion !== 'studytube-progress-write.v1' ||
    setupData.runId !== RUN_ID ||
    setupData.plannedUniqueWrites !== WRITE_VUS * WRITE_ITERATIONS ||
    !Number.isInteger(setupData.baselineVersion) ||
    setupData.baselineVersion < 0
  ) {
    failExecutionGuard('The guarded setup result is missing or invalid; refusing progress writes.');
  }
}

assertSafeConfiguration();

function expectStatus(response, flow, expectedStatus) {
  const passed = check(
    response,
    { [`${flow} returns ${expectedStatus}`]: (item) => item.status === expectedStatus },
    { flow },
  );
  flowErrors.add(!passed, { flow });
  return passed;
}

export function setup() {
  assertExecutionPlan();
  guardErrors.add(false, { guard: 'execution' });
  const response = http.get(READINESS_URL, {
    tags: { flow: 'readiness', name: 'GET readiness' },
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
  });
  if (!expectStatus(response, 'readiness', 200)) {
    fail('Target readiness failed before the progress write scenario started.');
  }
  const baseline = http.get(PROGRESS_URL, {
    headers: { Cookie: SESSION_COOKIE },
    tags: { flow: 'progress_baseline', name: 'GET /learning/course-steps/:stepId/progress' },
    responseType: 'text',
    responseCallback: http.expectedStatuses(200, 404),
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
  });
  const baselineStatusPassed = check(
    baseline,
    { 'progress_baseline returns 200 or 404': (item) => item.status === 200 || item.status === 404 },
    { flow: 'progress_baseline' },
  );
  flowErrors.add(!baselineStatusPassed, { flow: 'progress_baseline' });
  if (!baselineStatusPassed) {
    fail('Dedicated progress baseline could not be read.');
  }
  return {
    profile: 'dedicated-progress-write',
    guardVersion: 'studytube-progress-write.v1',
    runId: RUN_ID,
    plannedUniqueWrites: WRITE_VUS * WRITE_ITERATIONS,
    baselineVersion: progressVersion(baseline, true),
  };
}

function requestHeaders(idempotencyKey) {
  return {
    Cookie: SESSION_COOKIE,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
}

function includesRange(response, expectedStart, expectedEnd) {
  try {
    const parsed = JSON.parse(response.body || '{}');
    return (
      Array.isArray(parsed.watchedRanges) &&
      parsed.watchedRanges.some(
        (range) => Number(range.start) <= expectedStart && Number(range.end) >= expectedEnd,
      )
    );
  } catch {
    return false;
  }
}

function progressVersion(response, allowNotFound = false) {
  if (allowNotFound && response.status === 404) {
    return 0;
  }
  if (response.status !== 200) {
    fail('Dedicated progress version could not be read.');
  }
  try {
    const parsed = JSON.parse(response.body || '{}');
    if (!Number.isInteger(parsed.version) || parsed.version < 1) {
      fail('Dedicated progress response has an invalid version.');
    }
    return parsed.version;
  } catch (error) {
    if (String(error).includes('invalid version')) {
      throw error;
    }
    fail('Dedicated progress response is not valid JSON.');
  }
}

export default function (setupData) {
  requireSetupGuard(setupData);
  assertExecutionPlan();
  const rangeIndex = (__VU - 1) * WRITE_ITERATIONS + __ITER;
  const startSeconds = rangeIndex / 16;
  const endSeconds = startSeconds + 1 / 32;
  const payload = JSON.stringify({
    startSeconds,
    endSeconds,
    lastPositionSeconds: endSeconds,
    occurredAt: new Date().toISOString(),
  });
  const idempotencyKey = `${RUN_ID}-v${__VU}-i${__ITER}`;

  const write = http.post(PROGRESS_URL, payload, {
    headers: requestHeaders(idempotencyKey),
    tags: { flow: 'progress_write', name: 'POST /learning/course-steps/:stepId/progress' },
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
  });
  writeDuration.add(write.timings.duration);
  expectStatus(write, 'progress_write', 200);

  const duplicate = http.post(PROGRESS_URL, payload, {
    headers: requestHeaders(idempotencyKey),
    tags: { flow: 'progress_duplicate', name: 'POST /learning/course-steps/:stepId/progress' },
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
  });
  duplicateDuration.add(duplicate.timings.duration);
  expectStatus(duplicate, 'progress_duplicate', 200);

  const readback = http.get(PROGRESS_URL, {
    headers: { Cookie: SESSION_COOKIE },
    tags: { flow: 'progress_readback', name: 'GET /learning/course-steps/:stepId/progress' },
    responseType: 'text',
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
  });
  readbackDuration.add(readback.timings.duration);
  const readbackPassed = check(
    readback,
    {
      'progress_readback returns 200': (item) => item.status === 200,
      'progress_readback includes the written range': (item) =>
        includesRange(item, startSeconds, endSeconds),
    },
    { flow: 'progress_readback' },
  );
  flowErrors.add(!readbackPassed, { flow: 'progress_readback' });
}

export function teardown(setupData) {
  requireSetupGuard(setupData);
  assertExecutionPlan();
  const response = http.get(PROGRESS_URL, {
    headers: { Cookie: SESSION_COOKIE },
    tags: {
      flow: 'progress_version_contract',
      name: 'GET /learning/course-steps/:stepId/progress',
    },
    responseType: 'text',
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
  });
  const expectedVersion = setupData.baselineVersion + WRITE_VUS * WRITE_ITERATIONS;
  const finalVersion = response.status === 200 ? progressVersion(response) : null;
  const passed = check(
    response,
    {
      'progress idempotency version delta matches unique writes': (item) =>
        item.status === 200 && finalVersion === expectedVersion,
    },
    { flow: 'progress_version_contract' },
  );
  versionErrors.add(!passed, { flow: 'progress_version_contract' });
  flowErrors.add(!passed, { flow: 'progress_version_contract' });
  if (!passed) {
    fail('Progress idempotency version contract failed.');
  }
}

function durationValues(data, metricName) {
  const metric = data.metrics[metricName];
  if (!metric || !metric.values) {
    return null;
  }
  return {
    p50Ms: metric.values.med ?? null,
    p95Ms: metric.values['p(95)'] ?? null,
    p99Ms: metric.values['p(99)'] ?? null,
    averageMs: metric.values.avg ?? null,
    maximumMs: metric.values.max ?? null,
    samples: metric.values.count ?? null,
  };
}

function scalarValues(data, metricName) {
  const metric = data.metrics[metricName];
  return metric && metric.values ? metric.values : null;
}

function thresholdResults(data) {
  const results = {};
  for (const [name, metric] of Object.entries(data.metrics)) {
    if (!metric.thresholds) {
      continue;
    }
    results[name] = Object.fromEntries(
      Object.entries(metric.thresholds).map(([threshold, outcome]) => [threshold, Boolean(outcome.ok)]),
    );
  }
  return results;
}

export function handleSummary(data) {
  const thresholds = thresholdResults(data);
  const requiredThresholdMetrics = [
    'checks',
    'progress_flow_errors',
    'progress_guard_errors',
    'progress_version_errors',
    'http_req_failed',
    'progress_write',
    'progress_duplicate',
    'progress_readback',
  ];
  const missingThresholdMetrics = requiredThresholdMetrics.filter(
    (name) => !thresholds[name] || Object.keys(thresholds[name]).length === 0,
  );
  const requiredThresholdsPassed = requiredThresholdMetrics.every(
    (name) => thresholds[name] && Object.values(thresholds[name]).every(Boolean),
  );
  const expectedSamples = WRITE_VUS * WRITE_ITERATIONS;
  const observedSamples = {
    progressWrite: data.metrics.progress_write?.values?.count ?? null,
    progressDuplicate: data.metrics.progress_duplicate?.values?.count ?? null,
    progressReadback: data.metrics.progress_readback?.values?.count ?? null,
  };
  const trendSamplesComplete = Object.values(observedSamples).every(
    (count) => count === expectedSamples,
  );
  const expectedHttpRequests = expectedSamples * 3 + 3;
  const observedHttpRequests = data.metrics.http_reqs?.values?.count ?? null;
  const requestVolumeComplete = observedHttpRequests === expectedHttpRequests;
  const evidenceComplete =
    missingThresholdMetrics.length === 0 && trendSamplesComplete && requestVolumeComplete;
  const evidence = {
    schemaVersion: 'studytube.progress-write-evidence.v1',
    runId: RUN_ID,
    status: evidenceComplete && requiredThresholdsPassed ? 'passed' : 'failed',
    completedAt: new Date().toISOString(),
    target: {
      baseUrl: BASE_URL,
      profile: 'authenticated-dedicated-write',
    },
    configuration: {
      profile: 'dedicated-progress-write',
      readinessUrl: READINESS_URL,
      dedicatedCourseStepConfigured: true,
      virtualUsers: WRITE_VUS,
      iterationsPerVirtualUser: WRITE_ITERATIONS,
      duplicateRequestPerIteration: true,
    },
    completeness: {
      complete: evidenceComplete,
      missingThresholdMetrics,
      expectedSamplesPerFlow: expectedSamples,
      observedSamples,
      expectedHttpRequests,
      observedHttpRequests,
    },
    latency: {
      progressWrite: durationValues(data, 'progress_write'),
      progressDuplicate: durationValues(data, 'progress_duplicate'),
      progressReadback: durationValues(data, 'progress_readback'),
    },
    volume: {
      iterations: scalarValues(data, 'iterations'),
      requests: scalarValues(data, 'http_reqs'),
      checks: scalarValues(data, 'checks'),
      flowErrors: scalarValues(data, 'progress_flow_errors'),
      httpFailures: scalarValues(data, 'http_req_failed'),
    },
    thresholds,
    retention: {
      credentialsRetained: false,
      responseBodiesRetained: false,
      rawDataIdentifiersRetained: false,
    },
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  return {
    stdout: serialized,
    [EVIDENCE_PATH]: serialized,
  };
}
