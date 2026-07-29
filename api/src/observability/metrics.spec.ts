import { MetricRegistry, StudyTubeMetrics, type AlarmRule } from './metrics';

describe('bounded Prometheus metrics', () => {
  it('records the production signals required by the API and worker', () => {
    const registry = new MetricRegistry();
    const metrics = new StudyTubeMetrics(registry);

    metrics.httpRequest('GET', '/api/posts/123?view=full', 503, 240);
    metrics.dbPoolWait(35);
    metrics.dbPoolSnapshot(8, 3, 2);
    metrics.dbTransactionRetry('approve_course', 'serialization_failure');
    metrics.outboxSnapshot(7, 19);
    metrics.outboxFailure('video_asset.requested', true);
    metrics.workerJob('durable-work', 'video_asset.requested', 'failed', 910);
    metrics.aiRequest('study_plan', 'gpt-5-mini', 'failed', 1_200, 420, 0.0042);

    const output = registry.toPrometheus();
    expect(output).toContain('studytube_http_request_duration_ms');
    expect(output).toContain('studytube_http_errors_total');
    expect(output).toContain('studytube_db_pool_wait_ms');
    expect(output).toContain('studytube_db_pool_connections{state="total"} 8');
    expect(output).toContain('studytube_db_pool_connections{state="idle"} 3');
    expect(output).toContain('studytube_db_pool_connections{state="busy"} 5');
    expect(output).toContain('studytube_db_pool_waiting 2');
    expect(output).toContain('studytube_db_transaction_retries_total');
    expect(output).toContain('studytube_outbox_pending 7');
    expect(output).toContain('studytube_outbox_oldest_age_seconds 19');
    expect(output).toContain('studytube_outbox_failures_total');
    expect(output).toContain('studytube_outbox_poison_total');
    expect(output).toContain('studytube_worker_jobs_total');
    expect(output).toContain('studytube_worker_job_duration_ms');
    expect(output).toContain('studytube_ai_request_duration_ms');
    expect(output).toContain('studytube_ai_tokens_total');
    expect(output).toContain('studytube_ai_cost_usd_total');
    expect(output).toContain('route="/api/posts/:id"');
    expect(output).not.toContain('/api/posts/123');
  });

  it('caps unseen label values instead of creating unbounded time series', () => {
    const registry = new MetricRegistry();
    const counter = registry.counter({
      name: 'test_events_total',
      help: 'Test events',
      labels: {
        tenant: { maxValues: 2, fallback: 'other' },
      },
    });

    counter.add(1, { tenant: 'alpha' });
    counter.add(1, { tenant: 'beta' });
    counter.add(1, { tenant: 'gamma' });

    const output = registry.toPrometheus();
    expect(output).toContain('tenant="alpha"');
    expect(output).toContain('tenant="beta"');
    expect(output).toContain('tenant="other"');
    expect(output).not.toContain('tenant="gamma"');
  });

  it('reports alarm, ok, and insufficient-data threshold states', () => {
    const registry = new MetricRegistry();
    const latency = registry.histogram({
      name: 'test_latency_ms',
      help: 'Test latency',
      buckets: [25, 50, 100, 250, 500],
      labels: {},
    });
    const rule: AlarmRule = {
      name: 'high_latency',
      metric: 'test_latency_ms',
      statistic: 'p95',
      operator: 'gt',
      threshold: 100,
    };

    expect(registry.evaluateAlarm(rule)).toEqual({
      name: 'high_latency',
      state: 'insufficient_data',
      threshold: 100,
    });

    latency.observe(20);
    latency.observe(40);
    expect(registry.evaluateAlarm(rule)).toEqual({
      name: 'high_latency',
      state: 'ok',
      observed: 50,
      threshold: 100,
    });

    latency.observe(420);
    expect(registry.evaluateAlarm(rule)).toEqual({
      name: 'high_latency',
      state: 'alarm',
      observed: 500,
      threshold: 100,
    });
  });
});
