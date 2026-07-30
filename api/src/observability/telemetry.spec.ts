import {
  startOpenTelemetry,
  type OpenTelemetryDependencies,
  type OpenTelemetrySdk,
} from './telemetry';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import {
  createTraceState,
  ROOT_CONTEXT,
  SpanStatusCode,
  TraceFlags,
  trace,
} from '@opentelemetry/api';
import { resources, type NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

describe('OpenTelemetry SDK registration', () => {
  it('starts an OTLP SDK with auto-instrumentation and the configured service name', () => {
    const sdk = fakeSdk();
    let receivedConfiguration: Record<string, unknown> | undefined;
    const dependencies: OpenTelemetryDependencies = {
      createSdk: (configuration) => {
        receivedConfiguration = configuration;
        return sdk;
      },
    };

    const registration = startOpenTelemetry(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/otel',
        OTEL_SERVICE_NAME: 'studytube-worker',
      },
      dependencies,
    );

    expect(registration.enabled).toBe(true);
    expect(sdk.startCount).toBe(1);
    expect(receivedConfiguration?.serviceName).toBe('studytube-worker');
    expect(receivedConfiguration?.traceExporter).toBeDefined();
    const instrumentations = receivedConfiguration?.instrumentations as
      | unknown[]
      | undefined;
    expect(instrumentations).toHaveLength(4);
    expect(instrumentations?.[0]).toBeInstanceOf(HttpInstrumentation);
    expect(instrumentations?.[1]).toBeInstanceOf(ExpressInstrumentation);
    expect(instrumentations?.[2]).toBeInstanceOf(NestInstrumentation);
    expect(instrumentations?.[3]).toBeInstanceOf(PgInstrumentation);
  });

  it('refuses plaintext OTLP export to a non-loopback host', () => {
    const sdk = fakeSdk();
    const dependencies = fakeDependencies(sdk);

    const registration = startOpenTelemetry(
      {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          'http://collector.example:4318/v1/traces',
      },
      dependencies,
    );

    expect(registration.enabled).toBe(false);
    expect(sdk.startCount).toBe(0);
    expect(dependencies.createSdk).not.toHaveBeenCalled();
  });

  it.each([
    'http://2130706433:4318/v1/traces',
    'http://0177.0.0.1:4318/v1/traces',
    'http://127.1:4318/v1/traces',
    'http://0x7f000001:4318/v1/traces',
  ])('refuses non-canonical loopback host encoding: %s', (endpoint) => {
    const sdk = fakeSdk();
    const dependencies = fakeDependencies(sdk);

    const registration = startOpenTelemetry(
      { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint },
      dependencies,
    );

    expect(registration.enabled).toBe(false);
    expect(dependencies.createSdk).not.toHaveBeenCalled();
  });

  it('stays disabled when OTLP traces are configured for a non-HTTP protocol', () => {
    const sdk = fakeSdk();
    const dependencies = fakeDependencies(sdk);

    const registration = startOpenTelemetry(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example',
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'grpc',
      },
      dependencies,
    );

    expect(registration.enabled).toBe(false);
    expect(dependencies.createSdk).not.toHaveBeenCalled();
  });

  it('stays disabled for an explicitly configured non-OTLP trace exporter', () => {
    const sdk = fakeSdk();
    const dependencies = fakeDependencies(sdk);

    const registration = startOpenTelemetry(
      {
        OTEL_TRACES_EXPORTER: 'console',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example',
      },
      dependencies,
    );

    expect(registration.enabled).toBe(false);
    expect(dependencies.createSdk).not.toHaveBeenCalled();
  });

  it('stays disabled for an endpoint with an empty port', () => {
    const sdk = fakeSdk();
    const dependencies = fakeDependencies(sdk);

    const registration = startOpenTelemetry(
      {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          'https://collector.example:/v1/traces',
      },
      dependencies,
    );

    expect(registration.enabled).toBe(false);
    expect(dependencies.createSdk).not.toHaveBeenCalled();
  });

  it.each([
    'ftp://collector.example/v1/traces',
    'https://user:password@collector.example/v1/traces',
    'https://@collector.example/v1/traces',
    'https://collector.example/v1/traces?token=endpoint-secret-canary',
    'https://collector.example/v1/traces#endpoint-secret-canary',
    'https://collector.example:65536/v1/traces',
  ])('stays disabled for an unsafe OTLP endpoint: %s', (endpoint) => {
    const sdk = fakeSdk();
    const dependencies = fakeDependencies(sdk);

    const registration = startOpenTelemetry(
      { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint },
      dependencies,
    );

    expect(registration.enabled).toBe(false);
    expect(dependencies.createSdk).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost:4318/v1/traces',
    'http://127.42.0.5:4318/v1/traces',
    'http://[::1]:4318/v1/traces',
    'https://collector.example/custom/traces',
  ])('accepts a safe trace-specific OTLP endpoint: %s', (endpoint) => {
    const sdk = fakeSdk();
    const exporter = {} as OTLPTraceExporter;
    const createTraceExporter = jest.fn(() => exporter);
    const dependencies = {
      ...fakeDependencies(sdk),
      createTraceExporter,
    };

    const registration = startOpenTelemetry(
      { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint },
      dependencies,
    );

    expect(registration.enabled).toBe(true);
    expect(createTraceExporter).toHaveBeenCalledWith(endpoint);
  });

  it('passes the validated generic endpoint explicitly to the trace exporter', () => {
    const sdk = fakeSdk();
    const exporter = {} as OTLPTraceExporter;
    const createTraceExporter = jest.fn(() => exporter);
    let receivedConfiguration: Record<string, unknown> | undefined;
    const dependencies = {
      createSdk: (configuration: Record<string, unknown>) => {
        receivedConfiguration = configuration;
        return sdk;
      },
      createTraceExporter,
    } as unknown as OpenTelemetryDependencies;

    const registration = startOpenTelemetry(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/otel/',
      },
      dependencies,
    );

    expect(registration.enabled).toBe(true);
    expect(createTraceExporter).toHaveBeenCalledWith(
      'https://collector.example/otel/v1/traces',
    );
    expect(receivedConfiguration?.traceExporter).not.toBe(exporter);
  });

  it('uses the validated trace-specific endpoint instead of an unsafe generic endpoint', () => {
    const sdk = fakeSdk();
    const exporter = {} as OTLPTraceExporter;
    const createTraceExporter = jest.fn(() => exporter);
    const dependencies = {
      ...fakeDependencies(sdk),
      createTraceExporter,
    };

    const registration = startOpenTelemetry(
      {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          'https://traces.example/custom/traces',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://untrusted.example:4318',
      },
      dependencies,
    );

    expect(registration.enabled).toBe(true);
    expect(createTraceExporter).toHaveBeenCalledWith(
      'https://traces.example/custom/traces',
    );
  });

  it('sanitizes every span at the production exporter seam', async () => {
    const sdk = fakeSdk();
    const delegate = new InMemorySpanExporter();
    let receivedConfiguration: Partial<NodeSDKConfiguration> | undefined;
    const secretCanaries = [
      'exception-message-secret-canary',
      'exception-stack-secret-canary',
      'query-secret-canary',
      'statement-secret-canary',
      'request-header-secret-canary',
      'response-header-secret-canary',
      'cookie-secret-canary',
      'session-secret-canary',
      'token-secret-canary',
      'password-secret-canary',
      'user-agent-secret-canary',
      'status-message-secret-canary',
      'trace-state-secret-canary',
      'resource-env-secret-canary',
      'link-secret-canary',
    ];
    const dependencies: OpenTelemetryDependencies = {
      createSdk: (configuration) => {
        receivedConfiguration = configuration;
        return sdk;
      },
      createTraceExporter: () => delegate,
    };

    startOpenTelemetry(
      {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          'https://collector.example/v1/traces',
        OTEL_SERVICE_NAME: 'studytube-sanitizer-test',
        OTEL_RESOURCE_ATTRIBUTES:
          'deployment.environment.token=resource-env-secret-canary',
      },
      dependencies,
    );

    const productionExporter = receivedConfiguration?.traceExporter;
    expect(productionExporter).toBeDefined();
    expect(productionExporter).not.toBe(delegate);
    expect(receivedConfiguration?.autoDetectResources).toBe(false);
    expect(receivedConfiguration?.resource?.attributes).toEqual({
      'service.name': 'studytube-sanitizer-test',
    });

    const traceState = createTraceState('vendor=trace-state-secret-canary');
    const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '1234567890abcdef1234567890abcdef',
      spanId: '1234567890abcdef',
      traceFlags: TraceFlags.SAMPLED,
      traceState,
      isRemote: true,
    });
    const provider = new NodeTracerProvider({
      resource: resources.resourceFromAttributes({
        'service.name': 'studytube-test',
        'deployment.environment.token': 'resource-env-secret-canary',
      }),
      spanProcessors: [new SimpleSpanProcessor(productionExporter!)],
    });
    const span = provider.getTracer('studytube.test').startSpan(
      'privacy probe',
      {
        attributes: {
          'safe.attribute': 'retained',
          'url.full':
            'https://studytube.page/learn?token=query-secret-canary#private',
          'url.query': 'token=query-secret-canary',
          'db.statement':
            "SELECT * FROM users WHERE email = 'statement-secret-canary'",
          'http.request.header.authorization':
            'Bearer request-header-secret-canary',
          'http.response.header.set_cookie':
            'sid=response-header-secret-canary',
          'http.cookie': 'cookie-secret-canary',
          'session.id': 'session-secret-canary',
          access_token: 'token-secret-canary',
          password: 'password-secret-canary',
          'user_agent.original': 'user-agent-secret-canary',
        },
        links: [
          {
            context: {
              traceId: 'abcdef1234567890abcdef1234567890',
              spanId: 'abcdef1234567890',
              traceFlags: TraceFlags.SAMPLED,
              traceState,
            },
            attributes: { 'link.token': 'link-secret-canary' },
          },
        ],
      },
      parentContext,
    );
    span.addEvent('exception', {
      'exception.type': 'Error',
      'exception.message': 'exception-message-secret-canary',
      'exception.stacktrace': 'exception-stack-secret-canary',
      'safe.event': 'retained',
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'status-message-secret-canary',
    });
    span.end();

    try {
      await provider.forceFlush();
      const exported = delegate.getFinishedSpans();
      expect(exported).toHaveLength(1);
      const exportedSpan = exported[0];
      const serialized = JSON.stringify({
        spanContext: exportedSpan.spanContext(),
        parentSpanContext: exportedSpan.parentSpanContext,
        attributes: exportedSpan.attributes,
        events: exportedSpan.events,
        links: exportedSpan.links,
        status: exportedSpan.status,
        resource: exportedSpan.resource.attributes,
      });

      for (const secret of secretCanaries) {
        expect(serialized).not.toContain(secret);
      }
      expect(exportedSpan.attributes).toMatchObject({
        'safe.attribute': 'retained',
        'url.full': 'https://studytube.page/learn',
      });
      expect(exportedSpan.attributes).not.toHaveProperty('url.query');
      expect(exportedSpan.attributes).not.toHaveProperty('db.statement');
      expect(exportedSpan.events[0]?.attributes).toEqual({
        'exception.type': 'Error',
        'safe.event': 'retained',
      });
      expect(exportedSpan.status).toEqual({
        code: SpanStatusCode.ERROR,
      });
      expect(exportedSpan.spanContext().traceState).toBeUndefined();
      expect(exportedSpan.parentSpanContext?.traceState).toBeUndefined();
      expect(exportedSpan.links[0]?.context.traceState).toBeUndefined();
      expect(exportedSpan.resource.attributes).toEqual({
        'service.name': 'studytube-test',
      });
    } finally {
      await provider.shutdown();
    }
  });

  it('redacts inbound URL queries before HTTP spans are created', () => {
    let receivedConfiguration: Record<string, unknown> | undefined;
    const dependencies: OpenTelemetryDependencies = {
      createSdk: (configuration) => {
        receivedConfiguration = configuration;
        return fakeSdk();
      },
    };

    startOpenTelemetry({ OTEL_TRACES_EXPORTER: 'otlp' }, dependencies);

    const instrumentations = receivedConfiguration?.instrumentations as
      | unknown[]
      | undefined;
    const httpInstrumentation = instrumentations?.[0] as HttpInstrumentation;
    const hook = httpInstrumentation.getConfig().startIncomingSpanHook;
    const privateQuery = 'search=private-learning-topic&cursor=opaque';

    expect(hook).toEqual(expect.any(Function));
    expect(hook?.({ url: `/posts?${privateQuery}` } as never)).toEqual({
      'url.query': '[REDACTED]',
    });
    expect(
      JSON.stringify(hook?.({ url: `/posts?${privateQuery}` } as never)),
    ).not.toContain(privateQuery);
    expect(hook?.({ url: '/health/ready' } as never)).toEqual({});
  });

  it('does not register an exporter when telemetry is not configured', () => {
    const sdk = fakeSdk();
    const dependencies = fakeDependencies(sdk);

    const registration = startOpenTelemetry({}, dependencies);

    expect(registration.enabled).toBe(false);
    expect(sdk.startCount).toBe(0);
    expect(dependencies.createSdk).not.toHaveBeenCalled();
  });

  it('honors the SDK disable flag even when an OTLP endpoint exists', () => {
    const sdk = fakeSdk();
    const dependencies = fakeDependencies(sdk);

    const registration = startOpenTelemetry(
      {
        OTEL_SDK_DISABLED: 'true',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector:4318/v1/traces',
      },
      dependencies,
    );

    expect(registration.enabled).toBe(false);
    expect(sdk.startCount).toBe(0);
  });

  it('shuts an enabled SDK down at most once', async () => {
    const sdk = fakeSdk();
    const dependencies = fakeDependencies(sdk);
    const registration = startOpenTelemetry(
      { OTEL_TRACES_EXPORTER: 'otlp' },
      dependencies,
    );

    await Promise.all([registration.shutdown(), registration.shutdown()]);

    expect(sdk.shutdownCount).toBe(1);
  });
});

function fakeDependencies(
  sdk: ReturnType<typeof fakeSdk>,
): OpenTelemetryDependencies & {
  createSdk: jest.MockedFunction<OpenTelemetryDependencies['createSdk']>;
} {
  return {
    createSdk: jest.fn(() => sdk),
  };
}

function fakeSdk(): OpenTelemetrySdk & {
  startCount: number;
  shutdownCount: number;
} {
  let startCount = 0;
  let shutdownCount = 0;
  return {
    get startCount() {
      return startCount;
    },
    get shutdownCount() {
      return shutdownCount;
    },
    start() {
      startCount += 1;
    },
    shutdown() {
      shutdownCount += 1;
      return Promise.resolve();
    },
  };
}
