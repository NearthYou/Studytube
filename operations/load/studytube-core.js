import http from 'k6/http';
import { check, fail, group, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = (__ENV.K6_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const READINESS_URL = (__ENV.K6_READINESS_URL || `${BASE_URL}/health/live`).replace(/\/+$/, '');
const SEARCH_TERM = __ENV.K6_SEARCH_TERM || '학습';
const SESSION_COOKIE = __ENV.K6_SESSION_COOKIE || '';
const RUN_ID = __ENV.K6_RUN_ID || `load-${new Date().toISOString().replace(/[-:.]/g, '')}`;
const EVIDENCE_PATH = __ENV.K6_EVIDENCE_PATH || `docs/evidence/operations/results/${RUN_ID}.json`;
const flowErrors = new Rate('flow_errors');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const START_VUS = positiveInteger(__ENV.K6_START_VUS, 2);
const TARGET_VUS = positiveInteger(__ENV.K6_TARGET_VUS, 10);
const RAMP_DURATION = __ENV.K6_RAMP_DURATION || '30s';
const STEADY_DURATION = __ENV.K6_STEADY_DURATION || '2m';
const COOL_DOWN_DURATION = __ENV.K6_COOL_DOWN_DURATION || '30s';

export const options = {
  discardResponseBodies: true,
  scenarios: {
    core_read_flow: {
      executor: 'ramping-vus',
      startVUs: START_VUS,
      stages: [
        { duration: RAMP_DURATION, target: TARGET_VUS },
        { duration: STEADY_DURATION, target: TARGET_VUS },
        { duration: COOL_DOWN_DURATION, target: 0 },
      ],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    flow_errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    'http_req_duration{flow:public_posts}': ['p(95)<800', 'p(99)<1500'],
    'http_req_duration{flow:posts}': ['p(95)<800', 'p(99)<1500'],
    'http_req_duration{flow:courses}': ['p(95)<800', 'p(99)<1500'],
    'http_req_duration{flow:search}': ['p(95)<1000', 'p(99)<1800'],
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
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
  if (__ENV.K6_ACKNOWLEDGE_LOAD !== 'true') {
    fail('Set K6_ACKNOWLEDGE_LOAD=true after confirming the target and test window.');
  }
  if (!isLoopbackTarget(BASE_URL) && __ENV.K6_ACKNOWLEDGE_TARGET !== BASE_URL) {
    fail('For a non-loopback target, K6_ACKNOWLEDGE_TARGET must exactly match K6_BASE_URL.');
  }
  if (
    targetAuthority(READINESS_URL) !== targetAuthority(BASE_URL) &&
    !isLoopbackTarget(READINESS_URL) &&
    __ENV.K6_ACKNOWLEDGE_READINESS_TARGET !== READINESS_URL
  ) {
    fail('A non-loopback readiness URL on another authority requires an exact K6_ACKNOWLEDGE_READINESS_TARGET match.');
  }
  if (!/^(?:__Host-)?studytube_session=[^\s;]+$/.test(SESSION_COOKIE)) {
    fail('K6_SESSION_COOKIE must contain only a StudyTube session cookie name and value.');
  }
}

function expectStatus(response, flow, expectedStatus) {
  const passed = check(
    response,
    { [`${flow} returns ${expectedStatus}`]: (item) => item.status === expectedStatus },
    { flow },
  );
  flowErrors.add(!passed, { flow });
  return passed;
}

function get(path, flow, headers) {
  const response = http.get(`${BASE_URL}${path}`, {
    tags: { flow },
    ...(headers ? { headers } : {}),
  });
  expectStatus(response, flow, 200);
  return response;
}

function sessionHeaders() {
  return { Cookie: SESSION_COOKIE };
}

export function setup() {
  assertSafeConfiguration();
  const response = http.get(READINESS_URL, { tags: { flow: 'readiness' } });
  if (!expectStatus(response, 'readiness', 200)) {
    fail('Target readiness failed before the load scenario started.');
  }
  return { runId: RUN_ID, profile: 'authenticated-read-only' };
}

export default function () {
  group('public lists', () => {
    get('/explore/posts?page=1&pageSize=20', 'public_posts');
    get('/explore/courses?limit=20', 'public_courses');
  });

  const headers = sessionHeaders();
  group('authenticated learning lists', () => {
    get('/posts?page=1&pageSize=20', 'posts', headers);
    get('/courses?limit=20', 'courses', headers);
    get(`/posts?search=${encodeURIComponent(SEARCH_TERM)}&page=1&pageSize=20`, 'search', headers);
  });
  sleep(Number(__ENV.K6_ITERATION_SLEEP_SECONDS || 1));
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
  const thresholdMetrics = Object.values(thresholds);
  const evidence = {
    schemaVersion: 'studytube.load-evidence.v1',
    runId: RUN_ID,
    status: thresholdMetrics.length > 0 && thresholdMetrics.every((metric) => Object.values(metric).every(Boolean))
      ? 'passed'
      : 'failed',
    completedAt: new Date().toISOString(),
    target: {
      baseUrl: BASE_URL,
      profile: 'authenticated-read-only',
    },
    configuration: {
      readinessUrl: READINESS_URL,
      authentication: 'preprovisioned-session',
      startVus: START_VUS,
      targetVus: TARGET_VUS,
      rampDuration: RAMP_DURATION,
      steadyDuration: STEADY_DURATION,
      coolDownDuration: COOL_DOWN_DURATION,
      fixedSearchTerm: SEARCH_TERM,
    },
    latency: {
      overall: durationValues(data, 'http_req_duration'),
      publicPosts: durationValues(data, 'http_req_duration{flow:public_posts}'),
      login: durationValues(data, 'http_req_duration{flow:login}'),
      posts: durationValues(data, 'http_req_duration{flow:posts}'),
      courses: durationValues(data, 'http_req_duration{flow:courses}'),
      search: durationValues(data, 'http_req_duration{flow:search}'),
    },
    volume: {
      iterations: scalarValues(data, 'iterations'),
      requests: scalarValues(data, 'http_reqs'),
      checks: scalarValues(data, 'checks'),
      flowErrors: scalarValues(data, 'flow_errors'),
      httpFailures: scalarValues(data, 'http_req_failed'),
    },
    thresholds,
    retention: {
      credentialsRetained: false,
      responseBodiesRetained: false,
      cookiesRetained: false,
    },
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  return {
    stdout: serialized,
    [EVIDENCE_PATH]: serialized,
  };
}
