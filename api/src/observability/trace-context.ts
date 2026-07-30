import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  isSpanContextValid,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  trace,
  type Attributes,
  type Span,
  type SpanContext,
  type TextMapGetter,
} from '@opentelemetry/api';

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

export type JobSpanOptions = {
  spanName?: string;
  attributes?: Attributes;
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
const JOB_TRACER_NAME = 'studytube.job';

const TRACE_HEADER_GETTER: TextMapGetter<TraceHeaderCarrier> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => {
    const value = caseInsensitiveHeader(carrier, key);
    return typeof value === 'string' || value === undefined
      ? value
      : Array.from(value);
  },
};

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
    const active = activeOpenTelemetryTraceContext();
    const activeParent =
      parent && (!active || parent.traceId === active.traceId)
        ? parent
        : undefined;
    const incomingRequestId = validCorrelationId(
      firstHeader(carrier, 'x-request-id'),
    );
    const context: ExecutionTraceContext = {
      kind: 'request',
      traceId: active?.traceId ?? parent?.traceId ?? this.ids.traceId(),
      spanId: active?.spanId ?? this.ids.spanId(),
      ...(activeParent ? { parentSpanId: activeParent.spanId } : {}),
      traceFlags: active?.traceFlags ?? parent?.traceFlags ?? '01',
      ...(active?.traceState || activeParent?.traceState
        ? { traceState: active?.traceState ?? activeParent?.traceState }
        : {}),
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
    const active = activeOpenTelemetryTraceContext();
    const traceContext =
      active?.traceId === context.traceId
        ? {
            ...active,
            requestId: context.requestId,
          }
        : context;

    deleteHeader(carrier, 'tracestate');
    injectTraceContext(
      {
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
        traceFlags: traceContext.traceFlags,
        requestId: context.requestId,
      },
      carrier,
    );
    carrier['x-studytube-job-id'] = safeJobId;
    return carrier;
  }

  runJob<T>(
    carrier: TraceHeaderCarrier,
    callback: () => T,
    options: JobSpanOptions = {},
  ): T {
    const parent = parseTraceParent(firstHeader(carrier, 'traceparent'));
    const traceParentCarrier = parent
      ? {
          traceparent: `00-${parent.traceId}-${parent.spanId}-${parent.traceFlags}`,
        }
      : {};
    const extractedContext = propagation.extract(
      ROOT_CONTEXT,
      traceParentCarrier,
      TRACE_HEADER_GETTER,
    );
    const tracer = trace.getTracer(JOB_TRACER_NAME);

    return tracer.startActiveSpan(
      options.spanName ?? `${JOB_TRACER_NAME} process`,
      {
        kind: SpanKind.CONSUMER,
        ...(options.attributes ? { attributes: options.attributes } : {}),
      },
      extractedContext,
      (span) => this.runJobInSpan(span, carrier, parent, callback),
    );
  }

  private runJobInSpan<T>(
    span: Span,
    carrier: TraceHeaderCarrier,
    parent: W3CTraceContext | undefined,
    callback: () => T,
  ): T {
    const active = openTelemetryTraceContext(span.spanContext());
    const requestId =
      validCorrelationId(firstHeader(carrier, 'x-request-id')) ??
      this.ids.requestId();
    const jobId = validCorrelationId(
      firstHeader(carrier, 'x-studytube-job-id'),
    );
    const context: ExecutionTraceContext = {
      kind: 'job',
      traceId: active?.traceId ?? parent?.traceId ?? this.ids.traceId(),
      spanId: active?.spanId ?? this.ids.spanId(),
      ...(parent && (!active || parent.traceId === active.traceId)
        ? { parentSpanId: parent.spanId }
        : {}),
      traceFlags: active?.traceFlags ?? parent?.traceFlags ?? '01',
      ...(active?.traceState || parent?.traceState
        ? { traceState: active?.traceState ?? parent?.traceState }
        : {}),
      requestId,
      ...(jobId ? { jobId } : {}),
    };

    try {
      const result = this.storage.run(context, callback);
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(
          (value) => {
            span.end();
            return value;
          },
          (error: unknown) => {
            recordSpanFailure(span);
            span.end();
            throw error;
          },
        ) as T;
      }
      span.end();
      return result;
    } catch (error) {
      recordSpanFailure(span);
      span.end();
      throw error;
    }
  }
}

function activeOpenTelemetryTraceContext(): W3CTraceContext | undefined {
  return openTelemetryTraceContext(trace.getActiveSpan()?.spanContext());
}

function openTelemetryTraceContext(
  spanContext: SpanContext | undefined,
): W3CTraceContext | undefined {
  if (!spanContext || !isSpanContextValid(spanContext)) {
    return undefined;
  }
  const traceState = spanContext.traceState?.serialize();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags & TraceFlags.SAMPLED ? '01' : '00',
    ...(traceState ? { traceState } : {}),
  };
}

function recordSpanFailure(span: Span): void {
  span.recordException({ name: 'Error' });
  span.setStatus({ code: SpanStatusCode.ERROR });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function firstHeader(
  carrier: TraceHeaderCarrier,
  expectedName: string,
): string | undefined {
  const value = caseInsensitiveHeader(carrier, expectedName);
  if (typeof value === 'string' || value === undefined) {
    return value;
  }
  return value[0];
}

function caseInsensitiveHeader(
  carrier: TraceHeaderCarrier,
  expectedName: string,
): string | readonly string[] | undefined {
  return Object.entries(carrier).find(
    ([name]) => name.toLowerCase() === expectedName.toLowerCase(),
  )?.[1];
}

function deleteHeader(
  carrier: Record<string, string>,
  expectedName: string,
): void {
  for (const name of Object.keys(carrier)) {
    if (name.toLowerCase() === expectedName.toLowerCase()) {
      delete carrier[name];
    }
  }
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
