export type MetricLabels = Record<string, string>;

export type MetricLabelPolicy = {
  allowedValues?: readonly string[];
  maxValues?: number;
  fallback?: string;
};

export type MetricDefinition = {
  name: string;
  help: string;
  labels: Record<string, MetricLabelPolicy>;
};

export type HistogramDefinition = MetricDefinition & {
  buckets: readonly number[];
};

export type AlarmRule = {
  name: string;
  metric: string;
  statistic: 'value' | 'sum' | 'p50' | 'p95' | 'p99';
  operator: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  labels?: MetricLabels;
};

export type AlarmEvaluation = {
  name: string;
  state: 'ok' | 'alarm' | 'insufficient_data';
  observed?: number;
  threshold: number;
};

export interface Counter {
  add(value?: number, labels?: MetricLabels): void;
}

export interface Gauge {
  set(value: number, labels?: MetricLabels): void;
  add(value: number, labels?: MetricLabels): void;
}

export interface Histogram {
  observe(value: number, labels?: MetricLabels): void;
}

type MetricKind = 'counter' | 'gauge' | 'histogram';
type SeriesKey = string;

type MetricSeries<T> = {
  labels: MetricLabels;
  value: T;
};

abstract class BaseMetric {
  protected readonly series = new Map<SeriesKey, MetricSeries<unknown>>();
  private readonly labelNames: readonly string[];
  private readonly observedValues = new Map<string, Set<string>>();

  constructor(
    readonly kind: MetricKind,
    readonly definition: MetricDefinition,
  ) {
    validateMetricDefinition(definition);
    this.labelNames = Object.keys(definition.labels).sort();
    for (const name of this.labelNames) {
      this.observedValues.set(name, new Set());
    }
  }

  abstract render(): readonly string[];

  abstract statistic(
    statistic: AlarmRule['statistic'],
    labels?: MetricLabels,
  ): number | undefined;

  protected normalizedSeries(labels: MetricLabels | undefined): {
    key: SeriesKey;
    labels: MetricLabels;
  } {
    const supplied = labels ?? {};
    for (const label of Object.keys(supplied)) {
      if (!this.definition.labels[label]) {
        throw new Error(
          `Metric ${this.definition.name} received undeclared label ${label}`,
        );
      }
    }

    const normalized: MetricLabels = {};
    for (const name of this.labelNames) {
      const policy = this.definition.labels[name];
      normalized[name] = this.boundLabelValue(
        name,
        supplied[name] ?? policy.fallback ?? 'unknown',
        policy,
      );
    }
    return {
      key: JSON.stringify(this.labelNames.map((name) => normalized[name])),
      labels: normalized,
    };
  }

  protected matchingSeries<T>(labels?: MetricLabels): MetricSeries<T>[] {
    const entries = [...this.series.values()] as MetricSeries<T>[];
    if (!labels) {
      return entries;
    }
    return entries.filter((entry) =>
      Object.entries(labels).every(
        ([key, value]) => entry.labels[key] === value,
      ),
    );
  }

  protected renderLabels(labels: MetricLabels, extra?: MetricLabels): string {
    const pairs = [...Object.entries(labels), ...Object.entries(extra ?? {})];
    if (pairs.length === 0) {
      return '';
    }
    return `{${pairs
      .map(([name, value]) => `${name}="${escapeLabelValue(value)}"`)
      .join(',')}}`;
  }

  private boundLabelValue(
    name: string,
    rawValue: string,
    policy: MetricLabelPolicy,
  ): string {
    const fallback = policy.fallback ?? 'other';
    const value = sanitizeLabelValue(rawValue, fallback);
    if (policy.allowedValues && !policy.allowedValues.includes(value)) {
      return fallback;
    }

    const observed = this.observedValues.get(name)!;
    if (observed.has(value) || value === fallback) {
      return value;
    }
    const maxValues = policy.maxValues ?? policy.allowedValues?.length ?? 20;
    if (observed.size >= maxValues) {
      return fallback;
    }
    observed.add(value);
    return value;
  }
}

class CounterMetric extends BaseMetric implements Counter {
  constructor(definition: MetricDefinition) {
    super('counter', definition);
  }

  add(value = 1, labels?: MetricLabels): void {
    requireFiniteNonNegative(value, this.definition.name);
    const normalized = this.normalizedSeries(labels);
    const current = this.series.get(normalized.key) as
      | MetricSeries<number>
      | undefined;
    this.series.set(normalized.key, {
      labels: normalized.labels,
      value: (current?.value ?? 0) + value,
    });
  }

  render(): readonly string[] {
    return this.matchingSeries<number>()
      .sort(compareSeries)
      .map(
        ({ labels, value }) =>
          `${this.definition.name}${this.renderLabels(labels)} ${formatNumber(value)}`,
      );
  }

  statistic(
    statistic: AlarmRule['statistic'],
    labels?: MetricLabels,
  ): number | undefined {
    if (statistic !== 'value' && statistic !== 'sum') {
      return undefined;
    }
    const entries = this.matchingSeries<number>(labels);
    return entries.length === 0
      ? undefined
      : entries.reduce((sum, entry) => sum + entry.value, 0);
  }
}

class GaugeMetric extends BaseMetric implements Gauge {
  constructor(definition: MetricDefinition) {
    super('gauge', definition);
  }

  set(value: number, labels?: MetricLabels): void {
    requireFinite(value, this.definition.name);
    const normalized = this.normalizedSeries(labels);
    this.series.set(normalized.key, {
      labels: normalized.labels,
      value,
    });
  }

  add(value: number, labels?: MetricLabels): void {
    requireFinite(value, this.definition.name);
    const normalized = this.normalizedSeries(labels);
    const current = this.series.get(normalized.key) as
      | MetricSeries<number>
      | undefined;
    this.series.set(normalized.key, {
      labels: normalized.labels,
      value: (current?.value ?? 0) + value,
    });
  }

  render(): readonly string[] {
    return this.matchingSeries<number>()
      .sort(compareSeries)
      .map(
        ({ labels, value }) =>
          `${this.definition.name}${this.renderLabels(labels)} ${formatNumber(value)}`,
      );
  }

  statistic(
    statistic: AlarmRule['statistic'],
    labels?: MetricLabels,
  ): number | undefined {
    if (statistic !== 'value' && statistic !== 'sum') {
      return undefined;
    }
    const entries = this.matchingSeries<number>(labels);
    if (entries.length === 0) {
      return undefined;
    }
    if (statistic === 'sum') {
      return entries.reduce((sum, entry) => sum + entry.value, 0);
    }
    return Math.max(...entries.map((entry) => entry.value));
  }
}

type HistogramValue = {
  buckets: number[];
  count: number;
  sum: number;
  max: number;
};

class HistogramMetric extends BaseMetric implements Histogram {
  private readonly buckets: readonly number[];

  constructor(readonly histogramDefinition: HistogramDefinition) {
    super('histogram', histogramDefinition);
    const buckets = [...histogramDefinition.buckets].sort(
      (left, right) => left - right,
    );
    if (
      buckets.length === 0 ||
      buckets.some((value) => !Number.isFinite(value) || value <= 0) ||
      new Set(buckets).size !== buckets.length
    ) {
      throw new Error(
        `Histogram ${histogramDefinition.name} requires unique positive finite buckets`,
      );
    }
    this.buckets = buckets;
  }

  observe(value: number, labels?: MetricLabels): void {
    requireFiniteNonNegative(value, this.definition.name);
    const normalized = this.normalizedSeries(labels);
    const current = this.series.get(normalized.key) as
      | MetricSeries<HistogramValue>
      | undefined;
    const histogram = current?.value ?? {
      buckets: this.buckets.map(() => 0),
      count: 0,
      sum: 0,
      max: 0,
    };
    histogram.count += 1;
    histogram.sum += value;
    histogram.max = Math.max(histogram.max, value);
    this.buckets.forEach((upperBound, index) => {
      if (value <= upperBound) {
        histogram.buckets[index] += 1;
      }
    });
    this.series.set(normalized.key, {
      labels: normalized.labels,
      value: histogram,
    });
  }

  render(): readonly string[] {
    const lines: string[] = [];
    for (const { labels, value } of this.matchingSeries<HistogramValue>().sort(
      compareSeries,
    )) {
      this.buckets.forEach((upperBound, index) => {
        lines.push(
          `${this.definition.name}_bucket${this.renderLabels(labels, {
            le: formatNumber(upperBound),
          })} ${String(value.buckets[index])}`,
        );
      });
      lines.push(
        `${this.definition.name}_bucket${this.renderLabels(labels, {
          le: '+Inf',
        })} ${String(value.count)}`,
        `${this.definition.name}_sum${this.renderLabels(labels)} ${formatNumber(value.sum)}`,
        `${this.definition.name}_count${this.renderLabels(labels)} ${String(value.count)}`,
      );
    }
    return lines;
  }

  statistic(
    statistic: AlarmRule['statistic'],
    labels?: MetricLabels,
  ): number | undefined {
    const entries = this.matchingSeries<HistogramValue>(labels);
    if (entries.length === 0) {
      return undefined;
    }
    if (statistic === 'sum') {
      return entries.reduce((sum, entry) => sum + entry.value.sum, 0);
    }
    if (statistic === 'value') {
      return entries.reduce((sum, entry) => sum + entry.value.count, 0);
    }

    const quantile =
      statistic === 'p50' ? 0.5 : statistic === 'p95' ? 0.95 : 0.99;
    const mergedCounts = this.buckets.map(() => 0);
    let total = 0;
    let maximum = 0;
    for (const entry of entries) {
      total += entry.value.count;
      maximum = Math.max(maximum, entry.value.max);
      entry.value.buckets.forEach((count, index) => {
        mergedCounts[index] += count;
      });
    }
    if (total === 0) {
      return undefined;
    }
    const target = Math.ceil(total * quantile);
    const index = mergedCounts.findIndex((count) => count >= target);
    return index >= 0 ? this.buckets[index] : maximum;
  }
}

export class MetricRegistry {
  private readonly metrics = new Map<string, BaseMetric>();

  counter(definition: MetricDefinition): Counter {
    return this.register(new CounterMetric(definition)) as CounterMetric;
  }

  gauge(definition: MetricDefinition): Gauge {
    return this.register(new GaugeMetric(definition)) as GaugeMetric;
  }

  histogram(definition: HistogramDefinition): Histogram {
    return this.register(new HistogramMetric(definition)) as HistogramMetric;
  }

  toPrometheus(): string {
    const lines: string[] = [];
    for (const metric of [...this.metrics.values()].sort((left, right) =>
      left.definition.name.localeCompare(right.definition.name),
    )) {
      lines.push(
        `# HELP ${metric.definition.name} ${escapeHelp(metric.definition.help)}`,
        `# TYPE ${metric.definition.name} ${metric.kind}`,
        ...metric.render(),
      );
    }
    return `${lines.join('\n')}\n`;
  }

  evaluateAlarm(rule: AlarmRule): AlarmEvaluation {
    requireFinite(rule.threshold, rule.name);
    const metric = this.metrics.get(rule.metric);
    const observed = metric?.statistic(rule.statistic, rule.labels);
    if (observed === undefined) {
      return {
        name: rule.name,
        state: 'insufficient_data',
        threshold: rule.threshold,
      };
    }
    return {
      name: rule.name,
      state: compareThreshold(observed, rule.operator, rule.threshold)
        ? 'alarm'
        : 'ok',
      observed,
      threshold: rule.threshold,
    };
  }

  private register(metric: BaseMetric): BaseMetric {
    const existing = this.metrics.get(metric.definition.name);
    if (existing) {
      if (existing.kind !== metric.kind) {
        throw new Error(
          `Metric ${metric.definition.name} is already registered as ${existing.kind}`,
        );
      }
      return existing;
    }
    this.metrics.set(metric.definition.name, metric);
    return metric;
  }
}

const SHORT_MS_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500];
const LONG_MS_BUCKETS = [25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 15_000];

export class StudyTubeMetrics {
  private readonly httpDuration: Histogram;
  private readonly httpErrors: Counter;
  private readonly dbPoolWaitDuration: Histogram;
  private readonly dbPoolConnections: Gauge;
  private readonly dbPoolWaiting: Gauge;
  private readonly dbTransactionRetries: Counter;
  private readonly outboxPending: Gauge;
  private readonly outboxOldestAge: Gauge;
  private readonly outboxFailures: Counter;
  private readonly outboxPoison: Counter;
  private readonly workerJobs: Counter;
  private readonly workerJobDuration: Histogram;
  private readonly aiDuration: Histogram;
  private readonly aiTokens: Counter;
  private readonly aiCost: Counter;

  constructor(registry: MetricRegistry) {
    const httpLabels = {
      method: {
        allowedValues: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        fallback: 'OTHER',
      },
      route: { maxValues: 100, fallback: 'other' },
      status_class: {
        allowedValues: ['1xx', '2xx', '3xx', '4xx', '5xx'],
        fallback: 'other',
      },
    } satisfies Record<string, MetricLabelPolicy>;
    this.httpDuration = registry.histogram({
      name: 'studytube_http_request_duration_ms',
      help: 'HTTP request latency in milliseconds',
      buckets: SHORT_MS_BUCKETS,
      labels: httpLabels,
    });
    this.httpErrors = registry.counter({
      name: 'studytube_http_errors_total',
      help: 'HTTP responses with a 4xx or 5xx status',
      labels: httpLabels,
    });
    this.dbPoolWaitDuration = registry.histogram({
      name: 'studytube_db_pool_wait_ms',
      help: 'Database pool acquisition wait in milliseconds',
      buckets: SHORT_MS_BUCKETS,
      labels: {},
    });
    this.dbPoolConnections = registry.gauge({
      name: 'studytube_db_pool_connections',
      help: 'Database pool connections by state',
      labels: {
        state: {
          allowedValues: ['total', 'idle', 'busy'],
          fallback: 'other',
        },
      },
    });
    this.dbPoolWaiting = registry.gauge({
      name: 'studytube_db_pool_waiting',
      help: 'Database operations waiting for a pool connection',
      labels: {},
    });
    this.dbTransactionRetries = registry.counter({
      name: 'studytube_db_transaction_retries_total',
      help: 'Database transaction retry attempts',
      labels: boundedLabels(['operation', 'reason'], 24),
    });
    this.outboxPending = registry.gauge({
      name: 'studytube_outbox_pending',
      help: 'Pending outbox events',
      labels: {},
    });
    this.outboxOldestAge = registry.gauge({
      name: 'studytube_outbox_oldest_age_seconds',
      help: 'Age of the oldest pending outbox event in seconds',
      labels: {},
    });
    this.outboxFailures = registry.counter({
      name: 'studytube_outbox_failures_total',
      help: 'Outbox processing failures',
      labels: boundedLabels(['event_type'], 32),
    });
    this.outboxPoison = registry.counter({
      name: 'studytube_outbox_poison_total',
      help: 'Outbox events sent to dead letter storage',
      labels: boundedLabels(['event_type'], 32),
    });
    const workerLabels = boundedLabels(['queue', 'event_type'], 32);
    workerLabels.outcome = {
      allowedValues: ['succeeded', 'failed', 'cancelled', 'retry'],
      fallback: 'other',
    };
    this.workerJobs = registry.counter({
      name: 'studytube_worker_jobs_total',
      help: 'Worker job outcomes',
      labels: workerLabels,
    });
    this.workerJobDuration = registry.histogram({
      name: 'studytube_worker_job_duration_ms',
      help: 'Worker job latency in milliseconds',
      buckets: LONG_MS_BUCKETS,
      labels: workerLabels,
    });
    const aiLabels = boundedLabels(['operation', 'model'], 24);
    aiLabels.outcome = {
      allowedValues: ['succeeded', 'failed', 'cancelled', 'timeout'],
      fallback: 'other',
    };
    this.aiDuration = registry.histogram({
      name: 'studytube_ai_request_duration_ms',
      help: 'AI request latency in milliseconds',
      buckets: LONG_MS_BUCKETS,
      labels: aiLabels,
    });
    this.aiTokens = registry.counter({
      name: 'studytube_ai_tokens_total',
      help: 'AI tokens consumed',
      labels: aiLabels,
    });
    this.aiCost = registry.counter({
      name: 'studytube_ai_cost_usd_total',
      help: 'Estimated AI cost in US dollars',
      labels: aiLabels,
    });
  }

  httpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const labels = {
      method: method.toUpperCase(),
      route: normalizeHttpRoute(route),
      status_class: statusClass(statusCode),
    };
    this.httpDuration.observe(durationMs, labels);
    if (statusCode >= 400) {
      this.httpErrors.add(1, labels);
    }
  }

  dbPoolWait(durationMs: number): void {
    this.dbPoolWaitDuration.observe(durationMs);
  }

  dbPoolSnapshot(total: number, idle: number, waiting: number): void {
    this.dbPoolConnections.set(total, { state: 'total' });
    this.dbPoolConnections.set(idle, { state: 'idle' });
    this.dbPoolConnections.set(Math.max(total - idle, 0), { state: 'busy' });
    this.dbPoolWaiting.set(waiting);
  }

  dbTransactionRetry(operation: string, reason: string): void {
    this.dbTransactionRetries.add(1, { operation, reason });
  }

  outboxSnapshot(pending: number, oldestAgeSeconds: number): void {
    this.outboxPending.set(pending);
    this.outboxOldestAge.set(oldestAgeSeconds);
  }

  outboxFailure(eventType: string, poison: boolean): void {
    this.outboxFailures.add(1, { event_type: eventType });
    if (poison) {
      this.outboxPoison.add(1, { event_type: eventType });
    }
  }

  workerJob(
    queue: string,
    eventType: string,
    outcome: string,
    durationMs: number,
  ): void {
    const labels = { queue, event_type: eventType, outcome };
    this.workerJobs.add(1, labels);
    this.workerJobDuration.observe(durationMs, labels);
  }

  aiRequest(
    operation: string,
    model: string,
    outcome: string,
    durationMs: number,
    tokens: number,
    costUsd: number,
  ): void {
    const labels = { operation, model, outcome };
    this.aiDuration.observe(durationMs, labels);
    this.aiTokens.add(tokens, labels);
    this.aiCost.add(costUsd, labels);
  }
}

export function normalizeHttpRoute(route: string): string {
  let pathname: string;
  try {
    pathname = new URL(route, 'http://studytube.invalid').pathname;
  } catch {
    return 'other';
  }
  const normalized = pathname
    .split('/')
    .map((segment) => {
      if (/^\d+$/u.test(segment)) {
        return ':id';
      }
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          segment,
        ) ||
        /^[0-9a-f]{20,}$/iu.test(segment)
      ) {
        return ':id';
      }
      return segment;
    })
    .join('/');
  return normalized.length > 0 && normalized.length <= 160
    ? normalized
    : 'other';
}

function boundedLabels(
  names: readonly string[],
  maxValues: number,
): Record<string, MetricLabelPolicy> {
  return Object.fromEntries(
    names.map((name) => [name, { maxValues, fallback: 'other' }]),
  );
}

function statusClass(statusCode: number): string {
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? `${Math.floor(statusCode / 100)}xx`
    : 'other';
}

function validateMetricDefinition(definition: MetricDefinition): void {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/u.test(definition.name)) {
    throw new Error(`Invalid Prometheus metric name ${definition.name}`);
  }
  for (const [name, policy] of Object.entries(definition.labels)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(name)) {
      throw new Error(`Invalid Prometheus label name ${name}`);
    }
    if (policy.maxValues !== undefined && policy.maxValues < 1) {
      throw new Error(
        `Metric label ${name} requires maxValues greater than zero`,
      );
    }
  }
}

function requireFinite(value: number, metric: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Metric ${metric} requires a finite value`);
  }
}

function requireFiniteNonNegative(value: number, metric: string): void {
  requireFinite(value, metric);
  if (value < 0) {
    throw new Error(`Metric ${metric} requires a non-negative value`);
  }
}

function sanitizeLabelValue(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= 128 &&
    !hasControlCharacters(normalized)
    ? normalized
    : fallback;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function compareSeries<T>(
  left: MetricSeries<T>,
  right: MetricSeries<T>,
): number {
  return JSON.stringify(left.labels).localeCompare(
    JSON.stringify(right.labels),
  );
}

function compareThreshold(
  observed: number,
  operator: AlarmRule['operator'],
  threshold: number,
): boolean {
  switch (operator) {
    case 'gt':
      return observed > threshold;
    case 'gte':
      return observed >= threshold;
    case 'lt':
      return observed < threshold;
    case 'lte':
      return observed <= threshold;
  }
}

function escapeLabelValue(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '\\"');
}

function escapeHelp(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toString();
}
