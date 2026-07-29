export type RetrievalEvaluationMode = 'lexical' | 'vector' | 'hybrid';

export type EvaluationHit = {
  sourceKey: string;
  citation: {
    sourceUrl: string;
    timestampSeconds: number | null;
  };
};

export type EvaluationModeResult = {
  latencyMs: number;
  hits: EvaluationHit[];
};

export type EmbeddingProbe = {
  latencyMs: number;
  cacheHit: boolean;
  inputTokens: number;
  costUsd: number;
};

export type RetrievalEvaluationQuery = {
  id: string;
  relevant: Array<{
    sourceKey: string;
    minTimestampSeconds?: number;
    maxTimestampSeconds?: number;
  }>;
  embeddingProbes: EmbeddingProbe[];
  modes: Record<RetrievalEvaluationMode, EvaluationModeResult>;
};

export type RetrievalEvaluationInput = {
  datasetHash: string;
  model: string;
  tuning: Record<string, number>;
  queries: RetrievalEvaluationQuery[];
};

export function summarizeRetrievalEvaluation(input: RetrievalEvaluationInput) {
  if (input.queries.length === 0) {
    throw new RangeError('Retrieval evaluation requires at least one query');
  }
  const quality = {
    lexical: summarizeMode(input.queries, 'lexical'),
    vector: summarizeMode(input.queries, 'vector'),
    hybrid: summarizeMode(input.queries, 'hybrid'),
  };
  const probes = input.queries.flatMap((query) => query.embeddingProbes);
  const paidProbes = probes.filter((probe) => !probe.cacheHit);
  const baselineImproved =
    quality.hybrid.recallAt3 >= quality.lexical.recallAt3 &&
    quality.hybrid.mrr >= quality.lexical.mrr &&
    quality.hybrid.ndcgAt5 >= quality.lexical.ndcgAt5 &&
    (quality.hybrid.recallAt3 > quality.lexical.recallAt3 ||
      quality.hybrid.mrr > quality.lexical.mrr ||
      quality.hybrid.ndcgAt5 > quality.lexical.ndcgAt5);

  return {
    schemaVersion: 1,
    datasetHash: input.datasetHash,
    model: input.model,
    tuning: input.tuning,
    queryCount: input.queries.length,
    quality,
    embedding: {
      probeCount: probes.length,
      cacheHitRate:
        probes.length === 0
          ? 0
          : round(
              probes.filter((probe) => probe.cacheHit).length / probes.length,
            ),
      inputTokens: paidProbes.reduce(
        (total, probe) => total + probe.inputTokens,
        0,
      ),
      estimatedCostUsd: round(
        probes.reduce((total, probe) => total + probe.costUsd, 0),
        12,
      ),
      p95Ms: percentile95(probes.map((probe) => probe.latencyMs)),
    },
    baselineImproved,
  };
}

function summarizeMode(
  queries: RetrievalEvaluationQuery[],
  mode: RetrievalEvaluationMode,
) {
  const perQuery = queries.map((query) => {
    if (query.relevant.length === 0) {
      throw new RangeError(`Query ${query.id} has no relevance judgments`);
    }
    const relevant = new Map(
      query.relevant.map((judgment) => [judgment.sourceKey, judgment]),
    );
    const hits = query.modes[mode].hits;
    const top3 = hits.slice(0, 3);
    const top5 = hits.slice(0, 5);
    const firstRelevantIndex = hits.findIndex((hit) =>
      relevant.has(hit.sourceKey),
    );
    const dcg = top5.reduce(
      (total, hit, index) =>
        total + (relevant.has(hit.sourceKey) ? 1 / Math.log2(index + 2) : 0),
      0,
    );
    const idealCount = Math.min(5, relevant.size);
    const idealDcg = Array.from({ length: idealCount }).reduce<number>(
      (total, _unused, index) => total + 1 / Math.log2(index + 2),
      0,
    );
    return {
      recallAt3:
        new Set(
          top3
            .filter((hit) => relevant.has(hit.sourceKey))
            .map((hit) => hit.sourceKey),
        ).size / relevant.size,
      reciprocalRank: firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1),
      ndcgAt5: idealDcg === 0 ? 0 : dcg / idealDcg,
      citationCoverage:
        query.relevant.filter((judgment) => {
          const hit = top5.find(
            (candidate) => candidate.sourceKey === judgment.sourceKey,
          );
          if (!hit || !hit.citation.sourceUrl.trim()) {
            return false;
          }
          const timestamp = hit.citation.timestampSeconds;
          return (
            timestamp !== null &&
            Number.isFinite(timestamp) &&
            timestamp >= (judgment.minTimestampSeconds ?? 0) &&
            timestamp <=
              (judgment.maxTimestampSeconds ?? Number.POSITIVE_INFINITY)
          );
        }).length / query.relevant.length,
    };
  });

  return {
    recallAt3: average(perQuery.map((value) => value.recallAt3)),
    mrr: average(perQuery.map((value) => value.reciprocalRank)),
    ndcgAt5: average(perQuery.map((value) => value.ndcgAt5)),
    citationCoverage: average(perQuery.map((value) => value.citationCoverage)),
    retrievalP95Ms: percentile95(
      queries.map((query) => query.modes[mode].latencyMs),
    ),
  };
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0, 3);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
