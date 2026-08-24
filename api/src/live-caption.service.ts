import { isUUID } from 'class-validator';
import type { AiProxyService } from './ai-proxy.service';
import { MAX_LEARNING_AUDIO_SECONDS } from './learning/provider-budget.repository';
import { STT_MODEL_SNAPSHOT } from './transcription.constants';

const MAX_CHUNK_SECONDS = 12;
const MAX_AUDIO_BASE64_LENGTH = 400_000;
const AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
]);

export type LiveCaptionChunk = Readonly<{
  ordinal: number;
  start: number;
  end: number;
  sourceLanguage: string;
  source: string;
  korean: string;
}>;

export type LiveCaptionSessionKey = Readonly<{
  userId: number;
  contextId: string;
  sessionId: string;
}>;

export type LiveCaptionChunkKey = LiveCaptionSessionKey &
  Readonly<{ ordinal: number }>;

export type CaptureLiveCaptionInput = Readonly<{
  contextId: string;
  sessionId: string;
  ordinal: number;
  startSeconds: number;
  endSeconds: number;
  mimeType: string;
  audioBase64: string;
}>;

export type AppendLiveCaptionChunkCommand = LiveCaptionChunkKey &
  Readonly<{
    startSeconds: number;
    endSeconds: number;
    sourceLanguage: string;
    source: string;
    korean: string;
  }>;

export interface LiveCaptionRepository {
  hasActiveApproval(model: string): Promise<boolean>;
  findChunk(input: LiveCaptionChunkKey): Promise<LiveCaptionChunk | null>;
  appendChunk(input: AppendLiveCaptionChunkCommand): Promise<void>;
  finalize(input: LiveCaptionSessionKey): Promise<boolean>;
}

export class LiveCaptionService {
  constructor(
    private readonly ai: Pick<AiProxyService, 'transcribeLiveCaptionChunk'>,
    private readonly repository: LiveCaptionRepository,
  ) {}

  async capture(
    userId: number,
    input: CaptureLiveCaptionInput,
  ): Promise<LiveCaptionChunk> {
    validateCapture(input);
    const identity = {
      userId,
      contextId: input.contextId,
      sessionId: input.sessionId,
      ordinal: input.ordinal,
    };
    const stored = await this.repository.findChunk(identity);
    if (stored) return stored;
    if (!(await this.repository.hasActiveApproval(STT_MODEL_SNAPSHOT))) {
      throw new Error('현재 자막 만들기 한도에 도달했습니다.');
    }
    const result = await this.ai.transcribeLiveCaptionChunk({
      audioBase64: input.audioBase64,
      mimeType: input.mimeType,
      durationSeconds: input.endSeconds - input.startSeconds,
      model: STT_MODEL_SNAPSHOT,
    });
    const chunk: LiveCaptionChunk = {
      ordinal: input.ordinal,
      start: input.startSeconds,
      end: input.endSeconds,
      sourceLanguage: result.sourceLanguage,
      source: result.source,
      korean: result.korean,
    };
    await this.repository.appendChunk({
      ...identity,
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      sourceLanguage: chunk.sourceLanguage,
      source: chunk.source,
      korean: chunk.korean,
    });
    return chunk;
  }

  async finalize(
    userId: number,
    input: { contextId: string; sessionId: string },
  ): Promise<{ status: 'ready' }> {
    validateIdentity(input);
    const finalized = await this.repository.finalize({ userId, ...input });
    if (!finalized) throw new Error('저장할 자막이 없습니다.');
    return { status: 'ready' };
  }
}

function validateCapture(input: {
  contextId: string;
  sessionId: string;
  ordinal: number;
  startSeconds: number;
  endSeconds: number;
  mimeType: string;
  audioBase64: string;
}): void {
  validateIdentity(input);
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) {
    throw new RangeError('자막 순서가 올바르지 않습니다.');
  }
  if (
    !Number.isFinite(input.startSeconds) ||
    !Number.isFinite(input.endSeconds) ||
    input.startSeconds < 0 ||
    input.endSeconds <= input.startSeconds ||
    input.endSeconds - input.startSeconds > MAX_CHUNK_SECONDS
  ) {
    throw new RangeError('자막 구간이 올바르지 않습니다.');
  }
  if (input.endSeconds > MAX_LEARNING_AUDIO_SECONDS) {
    throw new RangeError('자막은 영상 앞부분 10분까지 만들 수 있습니다.');
  }
  if (!AUDIO_TYPES.has(input.mimeType.toLowerCase())) {
    throw new RangeError('이 브라우저의 음성 형식은 사용할 수 없습니다.');
  }
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(input.audioBase64) ||
    input.audioBase64.length > MAX_AUDIO_BASE64_LENGTH
  ) {
    throw new RangeError('녹음된 소리를 확인할 수 없습니다.');
  }
}

function validateIdentity(input: {
  contextId: string;
  sessionId: string;
}): void {
  if (!/^\d+$/u.test(input.contextId)) {
    throw new RangeError('학습 정보를 확인할 수 없습니다.');
  }
  if (!isUUID(input.sessionId, '4')) {
    throw new RangeError('자막 작업을 다시 시작해주세요.');
  }
}
