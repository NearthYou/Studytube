import { summarizeRetrievalEvaluation } from './retrieval-evaluation';

describe('retrieval evaluation metrics', () => {
  it('computes Recall@3, MRR, nDCG@5, citations, p95, cache, and cost', () => {
    const report = summarizeRetrievalEvaluation({
      datasetHash: 'abc123',
      model: 'text-embedding-3-small',
      tuning: {
        lexicalMinSimilarity: 0.05,
        vectorMaxDistance: 0.45,
        rrfK: 60,
        candidateLimit: 50,
      },
      queries: [
        {
          id: 'q1',
          relevant: [
            {
              sourceKey: 'post:1',
              minTimestampSeconds: 0,
              maxTimestampSeconds: 30,
            },
            {
              sourceKey: 'post:2',
              minTimestampSeconds: 0,
              maxTimestampSeconds: 30,
            },
          ],
          embeddingProbes: [
            { latencyMs: 20, cacheHit: false, inputTokens: 10, costUsd: 0.01 },
            { latencyMs: 2, cacheHit: true, inputTokens: 10, costUsd: 0 },
          ],
          modes: {
            lexical: result(10, ['post:3', 'post:1']),
            vector: result(20, ['post:2']),
            hybrid: result(30, ['post:1', 'post:2']),
          },
        },
        {
          id: 'q2',
          relevant: [
            {
              sourceKey: 'post:4',
              minTimestampSeconds: 0,
              maxTimestampSeconds: 30,
            },
          ],
          embeddingProbes: [
            { latencyMs: 40, cacheHit: false, inputTokens: 20, costUsd: 0.02 },
            { latencyMs: 3, cacheHit: true, inputTokens: 20, costUsd: 0 },
          ],
          modes: {
            lexical: result(40, []),
            vector: result(50, ['post:4']),
            hybrid: result(60, ['post:4']),
          },
        },
      ],
    });

    expect(report.quality.lexical.recallAt3).toBe(0.25);
    expect(report.quality.lexical.mrr).toBe(0.25);
    expect(report.quality.hybrid.recallAt3).toBe(1);
    expect(report.quality.hybrid.mrr).toBe(1);
    expect(report.quality.hybrid.ndcgAt5).toBe(1);
    expect(report.quality.hybrid.citationCoverage).toBe(1);
    expect(report.quality.hybrid.retrievalP95Ms).toBe(60);
    expect(report.embedding.cacheHitRate).toBe(0.5);
    expect(report.embedding.inputTokens).toBe(30);
    expect(report.embedding.estimatedCostUsd).toBeCloseTo(0.03);
    expect(report.embedding.p95Ms).toBe(40);
    expect(report.baselineImproved).toBe(true);
  });
});

function result(latencyMs: number, sourceKeys: string[]) {
  return {
    latencyMs,
    hits: sourceKeys.map((sourceKey, index) => ({
      sourceKey,
      citation: {
        sourceUrl: `https://youtu.be/source-${index}`,
        timestampSeconds: index * 10,
      },
    })),
  };
}
