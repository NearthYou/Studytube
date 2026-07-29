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

describe('W3C trace context', () => {
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
});
