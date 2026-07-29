import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';

export type TraceHeaderCarrier = Record<
  string,
  string | readonly string[] | undefined
>;

export type W3CTraceContext = {
  traceId: string;
  spanId: string;
  traceFlags: '00' | '01';
  traceState?: string;
  requestId?: string;
};

export type ExecutionTraceContext = W3CTraceContext & {
  kind: 'request' | 'job';
  parentSpanId?: string;
  requestId: string;
  jobId?: string;
};

export interface TraceIdFactory {
  traceId(): string;
  spanId(): string;
  requestId(): string;
}

const defaultIdFactory: TraceIdFactory = {
  traceId: () => nonZeroRandomHex(16),
  spanId: () => nonZeroRandomHex(8),
  requestId: () => randomUUID(),
};

const TRACE_PARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(00|01)$/u;
const SAFE_CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_SPAN_ID = '0'.repeat(16);

export function parseTraceParent(
  header: string | undefined,
): W3CTraceContext | undefined {
  if (!header) {
    return undefined;
  }

  const match = TRACE_PARENT_PATTERN.exec(header.trim());
  if (!match || match[1] === ZERO_TRACE_ID || match[2] === ZERO_SPAN_ID) {
    return undefined;
  }

  const traceFlags = match[3];
  if (traceFlags !== '00' && traceFlags !== '01') {
    return undefined;
  }
  return {
    traceId: match[1],
    spanId: match[2],
    traceFlags,
  };
}

export function extractTraceContext(
  carrier: TraceHeaderCarrier,
): W3CTraceContext | undefined {
  const trace = parseTraceParent(firstHeader(carrier, 'traceparent'));
  if (!trace) {
    return undefined;
  }

  const traceState = validTraceState(firstHeader(carrier, 'tracestate'));
  const requestId = validCorrelationId(firstHeader(carrier, 'x-request-id'));

  return {
    ...trace,
    ...(traceState ? { traceState } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

export function injectTraceContext(
  context: W3CTraceContext,
  carrier: Record<string, string> = {},
): Record<string, string> {
  carrier.traceparent = `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
  if (context.traceState) {
    carrier.tracestate = context.traceState;
  }
  if (context.requestId) {
    carrier['x-request-id'] = context.requestId;
  }
  return carrier;
}

export class TraceContextManager {
  private readonly storage = new AsyncLocalStorage<ExecutionTraceContext>();

  constructor(private readonly ids: TraceIdFactory = defaultIdFactory) {}

  current(): ExecutionTraceContext | undefined {
    return this.storage.getStore();
  }

  runRequest<T>(carrier: TraceHeaderCarrier, callback: () => T): T {
    const parent = extractTraceContext(carrier);
    const incomingRequestId = validCorrelationId(
      firstHeader(carrier, 'x-request-id'),
    );
    const context: ExecutionTraceContext = {
      kind: 'request',
      traceId: parent?.traceId ?? this.ids.traceId(),
      spanId: this.ids.spanId(),
      ...(parent ? { parentSpanId: parent.spanId } : {}),
      traceFlags: parent?.traceFlags ?? '01',
      ...(parent?.traceState ? { traceState: parent.traceState } : {}),
      requestId: incomingRequestId ?? this.ids.requestId(),
    };

    return this.storage.run(context, callback);
  }

  injectJob(
    jobId: string,
    carrier: Record<string, string> = {},
  ): Record<string, string> {
    const context = this.current();
    if (!context) {
      throw new Error('Cannot inject job context without an active trace');
    }
    const safeJobId = requireCorrelationId(jobId, 'job ID');

    injectTraceContext(context, carrier);
    carrier['x-studytube-job-id'] = safeJobId;
    return carrier;
  }

  runJob<T>(carrier: TraceHeaderCarrier, callback: () => T): T {
    const parent = extractTraceContext(carrier);
    const requestId =
      validCorrelationId(firstHeader(carrier, 'x-request-id')) ??
      this.ids.requestId();
    const jobId = validCorrelationId(
      firstHeader(carrier, 'x-studytube-job-id'),
    );
    const context: ExecutionTraceContext = {
      kind: 'job',
      traceId: parent?.traceId ?? this.ids.traceId(),
      spanId: this.ids.spanId(),
      ...(parent ? { parentSpanId: parent.spanId } : {}),
      traceFlags: parent?.traceFlags ?? '01',
      ...(parent?.traceState ? { traceState: parent.traceState } : {}),
      requestId,
      ...(jobId ? { jobId } : {}),
    };

    return this.storage.run(context, callback);
  }
}

function firstHeader(
  carrier: TraceHeaderCarrier,
  expectedName: string,
): string | undefined {
  const entry = Object.entries(carrier).find(
    ([name]) => name.toLowerCase() === expectedName,
  );
  if (!entry) {
    return undefined;
  }
  const value = entry[1];
  if (typeof value === 'string' || value === undefined) {
    return value;
  }
  return value[0];
}

function validTraceState(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 512 ||
    hasControlCharacters(trimmed) ||
    trimmed.split(',').length > 32
  ) {
    return undefined;
  }
  return trimmed;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function validCorrelationId(value: string | undefined): string | undefined {
  return value && SAFE_CORRELATION_ID_PATTERN.test(value) ? value : undefined;
}

function requireCorrelationId(value: string, description: string): string {
  const valid = validCorrelationId(value);
  if (!valid) {
    throw new Error(`${description} must be 1-128 safe ASCII characters`);
  }
  return valid;
}

function nonZeroRandomHex(bytes: number): string {
  let value = randomBytes(bytes).toString('hex');
  while (/^0+$/u.test(value)) {
    value = randomBytes(bytes).toString('hex');
  }
  return value;
}
