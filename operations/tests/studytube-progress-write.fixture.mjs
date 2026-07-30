import { createServer } from 'node:http';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`Missing required fixture argument: ${name}`);
  }
  return process.argv[index + 1];
}

const readyFile = argumentValue('--ready-file');
const sessionCookie = argumentValue('--session-cookie');
const courseStepId = argumentValue('--course-step-id');
const responseCanary = argumentValue('--response-canary');

if (!isAbsolute(readyFile)) {
  throw new Error('The fixture ready file must be an absolute path.');
}
if (!/^(?:__Host-)?studytube_session=[A-Za-z0-9_-]{16,128}$/.test(sessionCookie)) {
  throw new Error('The fixture session cookie is invalid.');
}
if (!/^[1-9]\d{5,18}$/.test(courseStepId)) {
  throw new Error('The fixture course step identifier is invalid.');
}
if (!/^[A-Za-z0-9_-]{16,128}$/.test(responseCanary)) {
  throw new Error('The fixture response canary is invalid.');
}

const progressPath = `/learning/course-steps/${courseStepId}/progress`;
const seenRequests = new Map();
const watchedRanges = [];
let version = 0;
const observations = {
  readinessRequests: 0,
  baselineReads: 0,
  postWriteReads: 0,
  writeRequests: 0,
  duplicateRequests: 0,
  uniqueMutations: 0,
  authenticationFailures: 0,
  protocolFailures: 0,
};

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function authenticated(request, response) {
  if (request.headers.cookie !== sessionCookie) {
    observations.authenticationFailures += 1;
    sendJson(response, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) {
      throw new Error('request too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (request, response) => {
  response.setHeader('Connection', 'close');
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

  if (requestUrl.search || requestUrl.hash) {
    observations.protocolFailures += 1;
    sendJson(response, 400, { error: 'query parameters are not supported' });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/health/live') {
    observations.readinessRequests += 1;
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/__fixture__/result') {
    sendJson(response, 200, observations);
    return;
  }

  if (requestUrl.pathname !== progressPath || !authenticated(request, response)) {
    if (requestUrl.pathname !== progressPath) {
      observations.protocolFailures += 1;
      sendJson(response, 404, { error: 'not found' });
    }
    return;
  }

  if (request.method === 'GET') {
    if (version === 0) {
      observations.baselineReads += 1;
      sendJson(response, 404, { error: 'not found', responseCanary });
      return;
    }
    observations.postWriteReads += 1;
    sendJson(response, 200, { version, watchedRanges, responseCanary });
    return;
  }

  if (request.method !== 'POST') {
    observations.protocolFailures += 1;
    sendJson(response, 405, { error: 'method not allowed' });
    return;
  }

  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    observations.protocolFailures += 1;
    sendJson(response, 415, { error: 'content type must be application/json' });
    return;
  }
  const idempotencyKey = String(request.headers['idempotency-key'] || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
    observations.protocolFailures += 1;
    sendJson(response, 400, { error: 'invalid idempotency key' });
    return;
  }

  try {
    const rawBody = await readBody(request);
    const payload = JSON.parse(rawBody);
    if (
      !Number.isFinite(payload.startSeconds) ||
      !Number.isFinite(payload.endSeconds) ||
      !Number.isFinite(payload.lastPositionSeconds) ||
      payload.startSeconds < 0 ||
      payload.endSeconds <= payload.startSeconds ||
      payload.endSeconds > 1 ||
      payload.lastPositionSeconds !== payload.endSeconds ||
      typeof payload.occurredAt !== 'string'
    ) {
      throw new Error('invalid progress payload');
    }

    const previousBody = seenRequests.get(idempotencyKey);
    if (previousBody !== undefined) {
      if (previousBody !== rawBody) {
        observations.protocolFailures += 1;
        sendJson(response, 409, { error: 'idempotency conflict' });
        return;
      }
      observations.duplicateRequests += 1;
      sendJson(response, 200, { version, responseCanary });
      return;
    }

    seenRequests.set(idempotencyKey, rawBody);
    watchedRanges.push({ start: payload.startSeconds, end: payload.endSeconds });
    version += 1;
    observations.writeRequests += 1;
    observations.uniqueMutations += 1;
    sendJson(response, 200, { version, responseCanary });
  }
  catch {
    observations.protocolFailures += 1;
    sendJson(response, 400, { error: 'invalid request' });
  }
});

server.requestTimeout = 5_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 1_000;

server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('The fixture did not bind an IPv4 loopback port.');
  }
  const temporaryReadyFile = `${readyFile}.${process.pid}.tmp`;
  writeFileSync(temporaryReadyFile, `${JSON.stringify({ port: address.port })}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  renameSync(temporaryReadyFile, readyFile);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Fail early if the ready file was accidentally reused with stale content.
try {
  readFileSync(readyFile, 'utf8');
  throw new Error('The fixture ready file already exists.');
}
catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}
