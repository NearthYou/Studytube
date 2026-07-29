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
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        OTEL_SERVICE_NAME: 'studytube-worker',
      },
      dependencies,
    );

    expect(registration.enabled).toBe(true);
    expect(sdk.startCount).toBe(1);
    expect(receivedConfiguration?.serviceName).toBe('studytube-worker');
    expect(receivedConfiguration?.traceExporter).toBeInstanceOf(
      OTLPTraceExporter,
    );
    const instrumentations = receivedConfiguration?.instrumentations as
      | unknown[]
      | undefined;
    expect(instrumentations).toHaveLength(4);
    expect(instrumentations?.[0]).toBeInstanceOf(HttpInstrumentation);
    expect(instrumentations?.[1]).toBeInstanceOf(ExpressInstrumentation);
    expect(instrumentations?.[2]).toBeInstanceOf(NestInstrumentation);
    expect(instrumentations?.[3]).toBeInstanceOf(PgInstrumentation);
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
