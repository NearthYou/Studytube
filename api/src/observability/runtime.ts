import { MetricRegistry, StudyTubeMetrics } from './metrics';
import { StructuredJsonLogger } from './structured-logger';
import { TraceContextManager } from './trace-context';

export type ObservabilityRuntime = Readonly<{
  traces: TraceContextManager;
  registry: MetricRegistry;
  metrics: StudyTubeMetrics;
  logger: StructuredJsonLogger;
}>;

export function createObservabilityRuntime(
  service = process.env.OTEL_SERVICE_NAME ?? 'studytube-api',
): ObservabilityRuntime {
  const traces = new TraceContextManager();
  const registry = new MetricRegistry();
  const metrics = new StudyTubeMetrics(registry);
  const logger = new StructuredJsonLogger({
    service,
    contextProvider: traces,
    ...(process.env.NODE_ENV === 'test' ? { write: () => undefined } : {}),
  });
  return Object.freeze({ traces, registry, metrics, logger });
}

export const observabilityRuntime = createObservabilityRuntime();
export const OBSERVABILITY_RUNTIME = Symbol('OBSERVABILITY_RUNTIME');
