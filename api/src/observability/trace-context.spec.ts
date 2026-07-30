import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  TraceFlags,
  trace,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  TraceContextManager,
  extractTraceContext,
  injectTraceContext,
  parseTraceParent,
  type TraceIdFactory,
} from './trace-context';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const PARENT_SPAN_ID = 'b7ad6b7169203331';
const REQUEST_SPAN_ID = '00f067aa0ba902b7';
const JOB_SPAN_ID = '4bf92f3577b34da6';
const ACTIVE_SPAN_ID = '1111111111111111';

describe('W3C trace context', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('extracts and injects a valid trace context without losing trace state', () => {
    const extracted = extractTraceContext({
      TraceParent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
      TraceState: 'vendor=value',
      'X-Request-Id': 'request-123',
    });

    expect(extracted).toEqual({
      traceId: TRACE_ID,
      spanId: PARENT_SPAN_ID,
      traceFlags: '01',
      traceState: 'vendor=value',
      requestId: 'request-123',
    });

    expect(injectTraceContext(extracted!)).toEqual({
      traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
      tracestate: 'vendor=value',
      'x-request-id': 'request-123',
    });
  });

  it.each([
    '',
    `01-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
    `00-${'0'.repeat(32)}-${PARENT_SPAN_ID}-01`,
    `00-${TRACE_ID}-${'0'.repeat(16)}-01`,
    `00-${TRACE_ID}-${PARENT_SPAN_ID}-ff`,
  ])('rejects malformed or unsafe traceparent input: %p', (header) => {
    expect(parseTraceParent(header)).toBeUndefined();
  });

  it('creates child request and job spans while preserving async context', async () => {
    const ids: TraceIdFactory = {
      traceId: jest.fn(() => TRACE_ID),
      spanId: jest
        .fn()
        .mockReturnValueOnce(REQUEST_SPAN_ID)
        .mockReturnValueOnce(JOB_SPAN_ID),
      requestId: jest.fn(() => 'generated-request'),
    };
    const manager = new TraceContextManager(ids);

    const incoming = {
      traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
      'x-request-id': 'request-123',
    };

    await manager.runRequest(incoming, async () => {
      await Promise.resolve();
      expect(manager.current()).toEqual({
        kind: 'request',
        traceId: TRACE_ID,
        spanId: REQUEST_SPAN_ID,
        parentSpanId: PARENT_SPAN_ID,
        traceFlags: '01',
        requestId: 'request-123',
      });

      const carrier = manager.injectJob('job-42');
      expect(carrier).toEqual({
        traceparent: `00-${TRACE_ID}-${REQUEST_SPAN_ID}-01`,
        'x-request-id': 'request-123',
        'x-studytube-job-id': 'job-42',
      });

      await manager.runJob(carrier, async () => {
        await Promise.resolve();
        expect(manager.current()).toEqual({
          kind: 'job',
          traceId: TRACE_ID,
          spanId: JOB_SPAN_ID,
          parentSpanId: REQUEST_SPAN_ID,
          traceFlags: '01',
          requestId: 'request-123',
          jobId: 'job-42',
        });
      });
    });

    expect(manager.current()).toBeUndefined();
  });

  it('starts a new trace and replaces invalid request identifiers', () => {
    const ids: TraceIdFactory = {
      traceId: () => TRACE_ID,
      spanId: () => REQUEST_SPAN_ID,
      requestId: () => 'generated-request',
    };
    const manager = new TraceContextManager(ids);

    manager.runRequest(
      {
        traceparent: 'invalid',
        'x-request-id': 'contains whitespace',
      },
      () => {
        expect(manager.current()).toEqual({
          kind: 'request',
          traceId: TRACE_ID,
          spanId: REQUEST_SPAN_ID,
          traceFlags: '01',
          requestId: 'generated-request',
        });
      },
    );
  });

  it('aligns request correlation with the active OpenTelemetry span', () => {
    const activeSpan = spanWithContext(TRACE_ID, ACTIVE_SPAN_ID);
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue(activeSpan);
    const fallbackTraceId = jest.fn(() => '1'.repeat(32));
    const fallbackSpanId = jest.fn(() => '2'.repeat(16));
    const ids: TraceIdFactory = {
      traceId: fallbackTraceId,
      spanId: fallbackSpanId,
      requestId: () => 'generated-request',
    };
    const manager = new TraceContextManager(ids);

    manager.runRequest({ 'x-request-id': 'request-otel' }, () => {
      expect(manager.current()).toMatchObject({
        kind: 'request',
        traceId: TRACE_ID,
        spanId: ACTIVE_SPAN_ID,
        traceFlags: '01',
        requestId: 'request-otel',
      });
    });

    expect(fallbackTraceId).not.toHaveBeenCalled();
    expect(fallbackSpanId).not.toHaveBeenCalled();
  });

  it('injects the currently active OpenTelemetry span into a queued job', () => {
    const requestSpan = spanWithContext(TRACE_ID, REQUEST_SPAN_ID);
    const enqueueSpan = spanWithContext(TRACE_ID, ACTIVE_SPAN_ID);
    jest
      .spyOn(trace, 'getActiveSpan')
      .mockReturnValueOnce(requestSpan)
      .mockReturnValue(enqueueSpan);
    const manager = new TraceContextManager({
      traceId: () => '1'.repeat(32),
      spanId: () => '2'.repeat(16),
      requestId: () => 'generated-request',
    });

    manager.runRequest({ 'x-request-id': 'request-otel' }, () => {
      expect(manager.injectJob('job-otel')).toMatchObject({
        traceparent: `00-${TRACE_ID}-${ACTIVE_SPAN_ID}-01`,
        'x-request-id': 'request-otel',
        'x-studytube-job-id': 'job-otel',
      });
    });
  });

  it('extracts the carrier and runs a job in an active consumer span', async () => {
    const extractedContext = {} as Context;
    const endConsumerSpan = jest.fn();
    const consumerSpan = spanWithContext(
      TRACE_ID,
      JOB_SPAN_ID,
      endConsumerSpan,
    );
    const extract = jest
      .spyOn(propagation, 'extract')
      .mockReturnValue(extractedContext);
    const startActiveSpan = jest.fn(
      (
        _name: string,
        _options: unknown,
        _parentContext: Context,
        callback: (span: Span) => Promise<string>,
      ) => callback(consumerSpan),
    );
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as unknown as Tracer);
    const fallbackTraceId = jest.fn(() => '1'.repeat(32));
    const fallbackSpanId = jest.fn(() => '2'.repeat(16));
    const ids: TraceIdFactory = {
      traceId: fallbackTraceId,
      spanId: fallbackSpanId,
      requestId: () => 'generated-request',
    };
    const manager = new TraceContextManager(ids);
    const carrier = {
      traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
      'x-request-id': 'request-otel',
      'x-studytube-job-id': 'job-otel',
    };

    await expect(
      manager.runJob(carrier, async () => {
        await Promise.resolve();
        expect(manager.current()).toEqual({
          kind: 'job',
          traceId: TRACE_ID,
          spanId: JOB_SPAN_ID,
          parentSpanId: PARENT_SPAN_ID,
          traceFlags: '01',
          requestId: 'request-otel',
          jobId: 'job-otel',
        });
        return 'processed';
      }),
    ).resolves.toBe('processed');

    expect(extract).toHaveBeenCalledWith(
      expect.anything(),
      {
        traceparent: carrier.traceparent,
      },
      expect.anything(),
    );
    expect(startActiveSpan).toHaveBeenCalledWith(
      'studytube.job process',
      expect.objectContaining({ kind: SpanKind.CONSUMER }),
      extractedContext,
      expect.any(Function),
    );
    expect(endConsumerSpan).toHaveBeenCalledTimes(1);
    expect(fallbackTraceId).not.toHaveBeenCalled();
    expect(fallbackSpanId).not.toHaveBeenCalled();
  });

  it('keeps real request-to-worker lineage without persisting inbound trace state', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register({ propagator: new W3CTraceContextPropagator() });
    const manager = new TraceContextManager();
    const incoming = {
      traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
      tracestate: 'vendor=trace-state-secret-canary',
      'x-request-id': 'request-real-lineage',
    };

    try {
      const remoteParent = propagation.extract(ROOT_CONTEXT, incoming);
      const carrier = await trace
        .getTracer('studytube.test')
        .startActiveSpan('request enqueue', {}, remoteParent, async (span) => {
          try {
            return await manager.runRequest(incoming, async () => {
              await Promise.resolve();
              return manager.injectJob('job-real-lineage');
            });
          } finally {
            span.end();
          }
        });
      const requestSpanId = parseTraceParent(carrier.traceparent)?.spanId;

      expect(carrier).toEqual({
        traceparent: `00-${TRACE_ID}-${requestSpanId}-01`,
        'x-request-id': 'request-real-lineage',
        'x-studytube-job-id': 'job-real-lineage',
      });

      await manager.runJob(
        {
          ...carrier,
          // Legacy or forged queue payloads must not reintroduce vendor data.
          tracestate: incoming.tracestate,
        },
        async () => {
          await Promise.resolve();
          expect(manager.current()).toMatchObject({
            kind: 'job',
            traceId: TRACE_ID,
            parentSpanId: requestSpanId,
            requestId: 'request-real-lineage',
            jobId: 'job-real-lineage',
          });
          expect(manager.current()?.traceState).toBeUndefined();
        },
        { spanName: 'video asset consume' },
      );
      await provider.forceFlush();

      const consumer = exporter
        .getFinishedSpans()
        .find((span) => span.name === 'video asset consume');
      expect(consumer?.spanContext().traceId).toBe(TRACE_ID);
      expect(consumer?.parentSpanContext?.spanId).toBe(requestSpanId);
      expect(
        JSON.stringify({
          spanContext: consumer?.spanContext(),
          parentSpanContext: consumer?.parentSpanContext,
          attributes: consumer?.attributes,
          events: consumer?.events,
          resource: consumer?.resource.attributes,
        }),
      ).not.toContain('trace-state-secret-canary');
    } finally {
      await provider.shutdown();
      trace.disable();
      propagation.disable();
      context.disable();
    }
  });

  it('exports a failed job span without the raw exception secret', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const manager = new TraceContextManager();
    const secret = 'Bearer job-exception-secret-canary';

    try {
      await expect(
        manager.runJob({}, async () => {
          await Promise.resolve();
          throw new Error(secret);
        }),
      ).rejects.toThrow(secret);
      await provider.forceFlush();

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      const exported = JSON.stringify(
        spans.map((span) => ({
          name: span.name,
          status: span.status,
          events: span.events.map((event) => ({
            name: event.name,
            attributes: event.attributes,
          })),
        })),
      );
      expect(exported).not.toContain(secret);
      expect(exported).toContain('Error');
    } finally {
      await provider.shutdown();
      trace.disable();
      propagation.disable();
      context.disable();
    }
  });
});

function spanWithContext(
  traceId: string,
  spanId: string,
  end: () => void = jest.fn(),
): Span {
  return {
    spanContext: () => ({
      traceId,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
    }),
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
    addEvent: jest.fn(),
    addLink: jest.fn(),
    addLinks: jest.fn(),
    setStatus: jest.fn(),
    updateName: jest.fn(),
    end,
    isRecording: () => true,
    recordException: jest.fn(),
  };
}
