import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK, type NodeSDKConfiguration } from '@opentelemetry/sdk-node';

type Environment = Readonly<Record<string, string | undefined>>;

export interface OpenTelemetrySdk {
  start(): void;
  shutdown(): Promise<void>;
}

export type OpenTelemetryDependencies = Readonly<{
  createSdk(configuration: Partial<NodeSDKConfiguration>): OpenTelemetrySdk;
}>;

export type OpenTelemetryRegistration = Readonly<{
  enabled: boolean;
  shutdown(): Promise<void>;
}>;

const defaultDependencies: OpenTelemetryDependencies = {
  createSdk: (configuration) => new NodeSDK(configuration),
};

const disabledRegistration: OpenTelemetryRegistration = Object.freeze({
  enabled: false,
  shutdown: () => Promise.resolve(),
});

export function startOpenTelemetry(
  environment: Environment = process.env,
  dependencies: OpenTelemetryDependencies = defaultDependencies,
): OpenTelemetryRegistration {
  if (!otlpTracingEnabled(environment)) {
    return disabledRegistration;
  }

  const sdk = dependencies.createSdk({
    serviceName: environment.OTEL_SERVICE_NAME?.trim() || 'studytube-api',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation(),
    ],
  });
  sdk.start();

  let shutdown: Promise<void> | undefined;
  return Object.freeze({
    enabled: true,
    shutdown: () => {
      shutdown ??= sdk.shutdown();
      return shutdown;
    },
  });
}

function otlpTracingEnabled(environment: Environment): boolean {
  if (environment.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true') {
    return false;
  }

  const exporters = environment.OTEL_TRACES_EXPORTER?.split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (exporters?.includes('none')) {
    return false;
  }
  if (exporters?.includes('otlp')) {
    return true;
  }

  return Boolean(
    environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim(),
  );
}
