import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import {
  resources,
  NodeSDK,
  type NodeSDKConfiguration,
} from '@opentelemetry/sdk-node';
import type {
  AttributeValue,
  Attributes,
  SpanContext,
} from '@opentelemetry/api';

type Environment = Readonly<Record<string, string | undefined>>;
type TraceExporter = NodeSDKConfiguration['traceExporter'];
type ReadableSpan = Parameters<TraceExporter['export']>[0][number];
type ExportResultCallback = Parameters<TraceExporter['export']>[1];

export interface OpenTelemetrySdk {
  start(): void;
  shutdown(): Promise<void>;
}

export type OpenTelemetryDependencies = Readonly<{
  createSdk(configuration: Partial<NodeSDKConfiguration>): OpenTelemetrySdk;
  createTraceExporter?(endpoint: string): TraceExporter;
}>;

export type OpenTelemetryRegistration = Readonly<{
  enabled: boolean;
  shutdown(): Promise<void>;
}>;

const defaultDependencies: OpenTelemetryDependencies = {
  createSdk: (configuration) => new NodeSDK(configuration),
  createTraceExporter: (endpoint) => new OTLPTraceExporter({ url: endpoint }),
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
  if (!otlpHttpProtocolEnabled(environment)) {
    return disabledRegistration;
  }
  const traceEndpoint = resolveOtlpTraceEndpoint(environment);
  if (!traceEndpoint) {
    return disabledRegistration;
  }
  const delegateTraceExporter =
    dependencies.createTraceExporter?.(traceEndpoint) ??
    defaultDependencies.createTraceExporter!(traceEndpoint);
  const traceExporter = new SanitizingSpanExporter(delegateTraceExporter);
  const serviceName = environment.OTEL_SERVICE_NAME?.trim() || 'studytube-api';

  const sdk = dependencies.createSdk({
    serviceName,
    // Do not import arbitrary OTEL_RESOURCE_ATTRIBUTES from the process.
    autoDetectResources: false,
    resource: resources.resourceFromAttributes({
      'service.name': serviceName,
    }),
    traceExporter,
    instrumentations: [
      new HttpInstrumentation({
        // Search terms and cursors are user data, not telemetry dimensions.
        startIncomingSpanHook: (request) =>
          request.url?.includes('?') ? { 'url.query': '[REDACTED]' } : {},
      }),
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

class SanitizingSpanExporter implements TraceExporter {
  constructor(private readonly delegate: TraceExporter) {}

  export(spans: ReadableSpan[], resultCallback: ExportResultCallback): void {
    this.delegate.export(spans.map(sanitizeSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }
}

function sanitizeSpan(span: ReadableSpan): ReadableSpan {
  return {
    name: span.name,
    kind: span.kind,
    spanContext: () => sanitizeSpanContext(span.spanContext()),
    ...(span.parentSpanContext
      ? {
          parentSpanContext: sanitizeSpanContext(span.parentSpanContext),
        }
      : {}),
    startTime: span.startTime,
    endTime: span.endTime,
    status: { code: span.status.code },
    attributes: sanitizeAttributes(span.attributes),
    links: span.links.map((link) => ({
      ...link,
      context: sanitizeSpanContext(link.context),
      ...(link.attributes
        ? { attributes: sanitizeAttributes(link.attributes) }
        : {}),
    })),
    events: span.events.map((event) => ({
      ...event,
      ...(event.attributes
        ? { attributes: sanitizeAttributes(event.attributes) }
        : {}),
    })),
    duration: span.duration,
    ended: span.ended,
    resource: resources.resourceFromAttributes(
      sanitizeAttributes(span.resource.attributes),
      {
        ...(span.resource.schemaUrl
          ? { schemaUrl: stripQueryAndFragment(span.resource.schemaUrl) }
          : {}),
      },
    ),
    instrumentationScope: {
      ...span.instrumentationScope,
      ...(span.instrumentationScope.schemaUrl
        ? {
            schemaUrl: stripQueryAndFragment(
              span.instrumentationScope.schemaUrl,
            ),
          }
        : {}),
    },
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

function sanitizeSpanContext(spanContext: SpanContext): SpanContext {
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
    ...(spanContext.isRemote === undefined
      ? {}
      : { isRemote: spanContext.isRemote }),
  };
}

const SENSITIVE_ATTRIBUTE_PARTS = new Set([
  'apikey',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'passwd',
  'password',
  'secret',
  'secrets',
  'session',
  'sessions',
  'statement',
  'token',
  'tokens',
]);

function sanitizeAttributes(attributes: Attributes | undefined): Attributes {
  const sanitized: Attributes = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === undefined) {
      continue;
    }
    const normalized = key.toLowerCase().replace(/-/gu, '_');
    const parts = normalized
      .replace(/[^a-z0-9]+/gu, '_')
      .split('_')
      .filter(Boolean);
    const compact = parts.join('');
    if (
      isExceptionDetail(parts) ||
      parts.includes('query') ||
      parts.includes('header') ||
      parts.includes('headers') ||
      parts.some((part) => SENSITIVE_ATTRIBUTE_PARTS.has(part)) ||
      compact.includes('apikey') ||
      compact.includes('useragent')
    ) {
      continue;
    }

    sanitized[key] = isUrlAttribute(normalized, parts)
      ? sanitizeUrlAttributeValue(value)
      : value;
  }
  return sanitized;
}

function isExceptionDetail(parts: string[]): boolean {
  return (
    (parts.includes('exception') || parts.includes('error')) &&
    (parts.includes('message') ||
      parts.includes('stack') ||
      parts.includes('stacktrace'))
  );
}

function isUrlAttribute(normalizedKey: string, parts: string[]): boolean {
  return (
    parts.includes('url') ||
    normalizedKey === 'http.target' ||
    normalizedKey === 'http.route'
  );
}

function sanitizeUrlAttributeValue(value: AttributeValue): AttributeValue {
  if (typeof value === 'string') {
    return stripQueryAndFragment(value);
  }
  if (isNullableStringArray(value)) {
    return value.map((item) =>
      typeof item === 'string' ? stripQueryAndFragment(item) : item,
    );
  }
  return value;
}

function isNullableStringArray(
  value: AttributeValue,
): value is Array<string | null | undefined> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => item === null || item === undefined || typeof item === 'string',
    )
  );
}

function stripQueryAndFragment(value: string): string {
  const queryIndex = value.indexOf('?');
  const fragmentIndex = value.indexOf('#');
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  return indexes.length ? value.slice(0, Math.min(...indexes)) : value;
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
  if (exporters?.length) {
    return exporters.includes('otlp');
  }

  return Boolean(
    environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim(),
  );
}

function otlpHttpProtocolEnabled(environment: Environment): boolean {
  const protocol = (
    environment.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL?.trim() ||
    environment.OTEL_EXPORTER_OTLP_PROTOCOL?.trim() ||
    'http/protobuf'
  ).toLowerCase();
  return protocol === 'http/protobuf';
}

function resolveOtlpTraceEndpoint(environment: Environment): string | null {
  const traceEndpoint = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (traceEndpoint) {
    return safeOtlpEndpoint(traceEndpoint);
  }

  const genericEndpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!genericEndpoint) {
    return 'http://localhost:4318/v1/traces';
  }

  const safeGenericEndpoint = safeOtlpEndpoint(genericEndpoint);
  if (!safeGenericEndpoint) {
    return null;
  }
  const url = new URL(safeGenericEndpoint);
  const basePath = url.pathname.replace(/\/+$/u, '');
  url.pathname = `${basePath}/v1/traces`;
  return url.toString();
}

function safeOtlpEndpoint(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    const authority = rawUrlAuthority(endpoint);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !authority ||
      authority.endsWith(':') ||
      authority.includes('@') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port === '0' ||
      (url.protocol === 'http:' && !isCanonicalLoopback(endpoint))
    ) {
      return null;
    }
    return endpoint;
  } catch {
    return null;
  }
}

function isCanonicalLoopback(endpoint: string): boolean {
  const authority = rawUrlAuthority(endpoint);
  if (!authority || authority.includes('@')) {
    return false;
  }
  const ipv6 = /^\[([^\]]+)\](?::[0-9]+)?$/u.exec(authority);
  if (ipv6) {
    return ipv6[1] === '::1';
  }
  const hostname = authority.replace(/:[0-9]+$/u, '');
  if (hostname.toLowerCase() === 'localhost') {
    return true;
  }
  const octets = hostname.split('.');
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => {
      return /^(?:0|[1-9][0-9]{0,2})$/u.test(octet) && Number(octet) <= 255;
    })
  );
}

function rawUrlAuthority(endpoint: string): string | undefined {
  return /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/iu.exec(endpoint)?.[1];
}
