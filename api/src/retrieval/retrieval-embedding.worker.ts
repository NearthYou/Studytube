import { randomUUID } from 'node:crypto';
import type { BoardRepository } from '../study-board.types';
import { WorkJobTerminalError } from '../work/video-asset.worker';
import type { WorkRepository } from '../work/work.repository';
import type { WorkQueueJob } from '../work/work.queue';
import type { RetrievalRepository } from './retrieval.repository';
import type {
  EmbeddingResponse,
  RetrievalChunk,
  RetrievalSourceKind,
  RetrievalSourceSnapshot,
} from './retrieval.types';

const RETRIEVAL_MODEL = 'text-embedding-3-small';
export const RETRIEVAL_CHUNK_MAX_CHARACTERS = 3000;
export const RETRIEVAL_CHUNK_MAX_COUNT = 128;
const RETRIEVAL_CHUNK_HEADER_MAX_CHARACTERS = 800;

type EmbeddingClient = {
  embedding(input: { input: string }): Promise<EmbeddingResponse>;
};
type ResultStore = Pick<
  WorkRepository,
  'findJobResult' | 'recordJobResult' | 'recordDeadLetter'
>;
type PreparedChunk = Omit<RetrievalChunk, 'embedding'>;

class RetrievalChunkingError extends Error {}

export class RetrievalEmbeddingJobHandler {
  constructor(
    legacySources: Pick<BoardRepository, 'findPost' | 'findVideoAsset'>,
    private readonly embeddings: EmbeddingClient,
    private readonly retrieval: Pick<
      RetrievalRepository,
      | 'readSourceSnapshot'
      | 'resolveEmbedding'
      | 'replaceSourceChunks'
      | 'removeMissingSourceChunks'
    >,
    private readonly results: ResultStore,
  ) {
    void legacySources;
  }

  async handle(job: WorkQueueJob): Promise<Record<string, unknown>> {
    const existing = await this.results.findJobResult(
      job.eventId,
      job.handlerVersion,
    );
    if (existing) {
      if (existing.outcome === 'terminal_failure') {
        throw new WorkJobTerminalError(
          typeof existing.result.code === 'string'
            ? existing.result.code
            : 'TERMINAL_FAILURE',
        );
      }
      return existing.result;
    }

    if (
      job.eventType !== 'retrieval_embedding.requested' ||
      job.payloadSchemaVersion !== 1
    ) {
      return this.terminal(job, 'UNSUPPORTED_RETRIEVAL_SCHEMA');
    }
    const source = parseSourcePayload(job.payload);
    if (!source) {
      return this.terminal(job, 'INVALID_RETRIEVAL_PAYLOAD');
    }
    const snapshot = await this.retrieval.readSourceSnapshot(source);
    if (!snapshot) {
      const indexingOutcome = await this.retrieval.removeMissingSourceChunks({
        sourceKind: source.sourceKind,
        sourceId: source.sourceId,
      });
      return this.succeeded(job, {
        sourceKind: source.sourceKind,
        sourceId: source.sourceId,
        model: RETRIEVAL_MODEL,
        indexingOutcome,
        chunkCount: 0,
      });
    }
    if (source.sourceVersion !== undefined) {
      const requestedVersion = BigInt(source.sourceVersion);
      const currentVersion = BigInt(snapshot.sourceVersion);
      if (requestedVersion < currentVersion) {
        return this.succeeded(job, {
          sourceKind: snapshot.sourceKind,
          sourceId: snapshot.sourceId,
          sourceVersion: snapshot.sourceVersion,
          indexingOutcome: 'superseded',
          chunkCount: 0,
        });
      }
      if (requestedVersion > currentVersion) {
        return this.terminal(job, 'RETRIEVAL_SOURCE_VERSION_AHEAD');
      }
    }

    let prepared: PreparedChunk[];
    try {
      prepared = buildRetrievalChunks(snapshot);
    } catch (error) {
      if (error instanceof RetrievalChunkingError) {
        return this.terminal(job, 'RETRIEVAL_SOURCE_TOO_LARGE');
      }
      throw error;
    }

    let cacheHitCount = 0;
    let inputTokens = 0;
    let estimatedCostUsd = 0;
    const chunks: RetrievalChunk[] = [];
    for (const chunk of prepared) {
      const embedded = await this.retrieval.resolveEmbedding(
        { model: RETRIEVAL_MODEL, content: chunk.content },
        () => this.embeddings.embedding({ input: chunk.content }),
      );
      if (
        embedded.model !== RETRIEVAL_MODEL ||
        embedded.dimensions !== 1536 ||
        embedded.embedding.length !== 1536 ||
        embedded.embedding.some((value) => !Number.isFinite(value))
      ) {
        return this.terminal(job, 'EMBEDDING_RESPONSE_INVALID');
      }
      if (embedded.cacheHit) {
        cacheHitCount += 1;
      }
      inputTokens += embedded.inputTokens ?? 0;
      estimatedCostUsd += embedded.estimatedCostUsd ?? 0;
      chunks.push({ ...chunk, embedding: embedded.embedding });
    }

    const indexingOutcome = await this.retrieval.replaceSourceChunks({
      sourceKind: snapshot.sourceKind,
      sourceId: snapshot.sourceId,
      sourceVersion: snapshot.sourceVersion,
      ownerId: snapshot.ownerId,
      visibility: snapshot.visibility,
      model: RETRIEVAL_MODEL,
      chunks,
    });
    return this.succeeded(job, {
      sourceKind: snapshot.sourceKind,
      sourceId: snapshot.sourceId,
      sourceVersion: snapshot.sourceVersion,
      model: RETRIEVAL_MODEL,
      dimensions: 1536,
      indexingOutcome,
      chunkCount: chunks.length,
      cacheHitCount,
      inputTokens,
      estimatedCostUsd,
    });
  }

  async recordExhaustedFailure(
    job: WorkQueueJob,
    error: Error,
    attemptsMade: number,
  ): Promise<void> {
    if (await this.results.findJobResult(job.eventId, job.handlerVersion)) {
      return;
    }
    const code = 'EMBEDDING_ATTEMPTS_EXHAUSTED';
    await this.results.recordDeadLetter({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      code,
      message: error.message,
      details: { attemptsMade },
    });
    await this.results.recordJobResult({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      outcome: 'terminal_failure',
      result: { code, attemptsMade },
    });
  }

  private async succeeded(
    job: WorkQueueJob,
    result: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.results.recordJobResult({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      outcome: 'succeeded',
      result,
    });
    return result;
  }

  private async terminal(job: WorkQueueJob, code: string): Promise<never> {
    await this.results.recordDeadLetter({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      code,
      message: code,
      details: { payloadSchemaVersion: job.payloadSchemaVersion },
    });
    await this.results.recordJobResult({
      id: randomUUID(),
      eventId: job.eventId,
      handlerVersion: job.handlerVersion,
      outcome: 'terminal_failure',
      result: { code },
    });
    throw new WorkJobTerminalError(code);
  }
}

export function buildRetrievalChunks(
  snapshot: RetrievalSourceSnapshot,
): PreparedChunk[] {
  const header = [
    snapshot.title,
    snapshot.summary,
    snapshot.translatedNotes,
    snapshot.tags.join(' '),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, RETRIEVAL_CHUNK_HEADER_MAX_CHARACTERS);
  const bodyLimit = Math.max(
    1,
    RETRIEVAL_CHUNK_MAX_CHARACTERS - header.length - (header ? 2 : 0),
  );
  const segments =
    snapshot.translatedSegments.length > 0
      ? snapshot.translatedSegments
      : snapshot.sourceSegments;
  const chunks =
    segments.length > 0
      ? chunksFromSegments(snapshot, header, bodyLimit, segments)
      : chunksFromText(snapshot, header, bodyLimit);
  if (chunks.length > RETRIEVAL_CHUNK_MAX_COUNT) {
    throw new RetrievalChunkingError('Retrieval source exceeds chunk limit');
  }
  return chunks;
}

function chunksFromSegments(
  snapshot: RetrievalSourceSnapshot,
  header: string,
  bodyLimit: number,
  segments: RetrievalSourceSnapshot['sourceSegments'],
): PreparedChunk[] {
  const units = segments
    .filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.start >= 0 &&
        segment.end > segment.start &&
        segment.text.trim().length > 0,
    )
    .sort((left, right) => left.start - right.start)
    .flatMap((segment) =>
      splitBoundedText(segment.text.trim(), bodyLimit).map((text) => ({
        text,
        start: Math.max(0, Math.floor(segment.start)),
        end: Math.max(Math.floor(segment.start) + 1, Math.ceil(segment.end)),
      })),
    );
  const groups: Array<typeof units> = [];
  let group: typeof units = [];
  let groupCharacters = 0;
  for (const unit of units) {
    const separator = group.length === 0 ? 0 : 1;
    if (
      group.length > 0 &&
      groupCharacters + separator + unit.text.length > bodyLimit
    ) {
      groups.push(group);
      group = [];
      groupCharacters = 0;
    }
    group.push(unit);
    groupCharacters += (group.length === 1 ? 0 : 1) + unit.text.length;
  }
  if (group.length > 0) {
    groups.push(group);
  }
  if (groups.length === 0) {
    return chunksFromText(snapshot, header, bodyLimit);
  }
  return groups.map((items, chunkIndex) => {
    const startSeconds = Math.min(...items.map((item) => item.start));
    const endSeconds = Math.max(...items.map((item) => item.end));
    return {
      chunkIndex,
      content: joinChunkContent(
        header,
        items.map((item) => item.text).join('\n'),
      ),
      startSeconds,
      endSeconds,
      sourceUrl: citationUrl(snapshot.sourceUrl, startSeconds),
    };
  });
}

function chunksFromText(
  snapshot: RetrievalSourceSnapshot,
  header: string,
  bodyLimit: number,
): PreparedChunk[] {
  const body = snapshot.transcriptBody.trim();
  const pieces = body ? splitBoundedText(body, bodyLimit) : [''];
  return pieces.map((piece, chunkIndex) => ({
    chunkIndex,
    content: joinChunkContent(header, piece),
    startSeconds: null,
    endSeconds: null,
    sourceUrl: snapshot.sourceUrl,
  }));
}

function joinChunkContent(header: string, body: string): string {
  const content = [header, body].filter(Boolean).join('\n\n').trim();
  if (!content || content.length > RETRIEVAL_CHUNK_MAX_CHARACTERS) {
    throw new RetrievalChunkingError('Retrieval chunk size is invalid');
  }
  return content;
}

function splitBoundedText(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit + 1);
    const whitespace = Math.max(
      candidate.lastIndexOf(' '),
      candidate.lastIndexOf('\n'),
      candidate.lastIndexOf('\t'),
    );
    const splitAt = whitespace >= Math.floor(limit * 0.5) ? whitespace : limit;
    pieces.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    pieces.push(remaining);
  }
  return pieces;
}

function citationUrl(url: string, timestampSeconds: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('t', `${timestampSeconds}s`);
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseSourcePayload(payload: Record<string, unknown>): {
  sourceKind: RetrievalSourceKind;
  sourceId: string;
  sourceVersion?: string;
} | null {
  const legacyPostId = canonicalPositiveInteger(payload.postId);
  const sourceKind =
    payload.sourceKind === 'post' || payload.sourceKind === 'course_step'
      ? payload.sourceKind
      : legacyPostId
        ? 'post'
        : null;
  const sourceId = canonicalPositiveInteger(payload.sourceId) ?? legacyPostId;
  if (!sourceKind || !sourceId) {
    return null;
  }
  if (payload.sourceVersion === undefined) {
    return { sourceKind, sourceId };
  }
  const sourceVersion = canonicalPositiveInteger(payload.sourceVersion);
  return sourceVersion ? { sourceKind, sourceId, sourceVersion } : null;
}

function canonicalPositiveInteger(value: unknown): string | null {
  if (
    typeof value === 'number' &&
    (!Number.isSafeInteger(value) || value <= 0)
  ) {
    return null;
  }
  const normalized = typeof value === 'number' ? String(value) : value;
  return typeof normalized === 'string' && /^[1-9][0-9]*$/u.test(normalized)
    ? normalized
    : null;
}
