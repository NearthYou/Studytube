import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AiProxyService } from '../ai-proxy.service';
import { DatabaseService } from '../database.service';
import { Public } from '../auth/public.decorator';
import { LearningService } from '../learning/learning.service';
import type { RecordAgentToolCallCommand } from '../learning/learning.repository';
import {
  McpServiceAssertionGuard,
  requireMcpCapability,
  type McpAuthenticatedRequest,
} from './mcp-service-assertion.guard';
import type { ProposedCourseStep } from '../learning/learning.types';
import type { McpLearningCapability } from './mcp-service-assertion';

const SEARCH_KEYS = new Set(['schemaVersion', 'query', 'limit']);
const LEARNING_PLAN_KEYS = new Set([
  'schemaVersion',
  'objective',
  'requestedStepCount',
]);
const AUDIT_KEYS = new Set([
  'schemaVersion',
  'runId',
  'attemptId',
  'requestId',
  'toolName',
  'inputSchemaVersion',
  'outputSchemaVersion',
  'durationMs',
  'outcome',
  'source',
  'input',
  'output',
]);
const OUTCOMES = new Set<RecordAgentToolCallCommand['outcome']>([
  'succeeded',
  'timeout',
  'invalid_schema',
  'failed',
  'budget_exhausted',
]);
const TOOL_NAMES = new Set([
  'search_studytube',
  'fetch_youtube_metadata',
  'search_learning_evidence',
  'read_learning_state',
  'verify_learning_video_metadata',
  'request_learning_quiz',
  'propose_next_learning',
]);
const TOOL_CAPABILITIES = new Map<string, McpLearningCapability>([
  ['search_studytube', 'learning:evidence:search'],
  ['search_learning_evidence', 'learning:evidence:search'],
  ['fetch_youtube_metadata', 'learning:metadata:verify'],
  ['verify_learning_video_metadata', 'learning:metadata:verify'],
  ['read_learning_state', 'learning:state:read'],
  ['request_learning_quiz', 'learning:quiz:request'],
  ['propose_next_learning', 'learning:proposal:create'],
]);

@Public()
@UseGuards(McpServiceAssertionGuard)
@Controller('internal/mcp')
export class McpController {
  constructor(
    private readonly aiProxy: AiProxyService,
    private readonly learning: LearningService,
    private readonly database: DatabaseService,
  ) {}

  @Post('learning/plan')
  @HttpCode(HttpStatus.OK)
  async createLearningPlan(
    @Req() request: McpAuthenticatedRequest,
    @Body() rawBody: unknown,
  ) {
    requireMcpCapability(request, 'learning:evidence:search');
    requireMcpCapability(request, 'learning:metadata:verify');
    requireMcpCapability(request, 'learning:proposal:create');
    const claims = request.mcpClaims;
    const authorized = await this.learning.authorizeAgentMcpCall({
      ownerId: claims.ownerId,
      runId: claims.runId,
      attemptId: claims.attemptId,
      leaseToken: claims.leaseToken,
      contextSnapshotId: claims.contextSnapshotId,
      capability: 'learning:proposal:create',
    });
    if (!authorized) {
      throw new ForbiddenException('MCP learning context rejected');
    }
    const body = exactObject(rawBody, LEARNING_PLAN_KEYS);
    if (body.schemaVersion !== 1) throw invalidRequest();
    const objective = boundedString(body.objective, 500).trim();
    const requestedStepCount = boundedInteger(body.requestedStepCount, 3, 6);
    if (!objective) throw invalidRequest();
    const startedAt = performance.now();
    try {
      const response = await this.aiProxy.recommend(
        {
          query: objective,
          limit: Math.min(10, requestedStepCount * 2),
          contextSnapshotId: claims.contextSnapshotId,
        },
        claims.ownerId,
      );
      const proposedSteps = await verifiedProposedSteps(
        response,
        requestedStepCount,
        this.database,
      );
      const usage = safeUsage(response);
      const resourceIds = proposedSteps.map((step) => step.sourcePostId);
      const accepted = await this.learning.recordAgentToolCall({
        ownerId: claims.ownerId,
        runId: claims.runId,
        attemptId: claims.attemptId,
        requestId: claims.requestId,
        toolName: 'propose_next_learning',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        outcome: 'succeeded',
        source: 'mcp-loopback-http',
        input: {
          contextSnapshotId: claims.contextSnapshotId,
          requestedStepCount,
        },
        output: {
          resourceIds,
          resourceCount: resourceIds.length,
          proposalVersion: 1,
          outcome: 'succeeded',
        },
      });
      if (!accepted) throw new ForbiddenException('MCP audit rejected');
      return {
        schemaVersion: 1,
        proposedSteps,
        usage,
        evidenceCount: proposedSteps.length,
        proposalVersion: 1,
      };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new BadGatewayException('MCP learning plan unavailable');
    }
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  async search(
    @Req() request: McpAuthenticatedRequest,
    @Body() rawBody: unknown,
  ) {
    requireMcpCapability(request, 'learning:evidence:search');
    const claims = request.mcpClaims;
    const authorized = await this.learning.authorizeAgentMcpCall({
      ownerId: claims.ownerId,
      runId: claims.runId,
      attemptId: claims.attemptId,
      leaseToken: claims.leaseToken,
      contextSnapshotId: claims.contextSnapshotId,
      capability: 'learning:evidence:search',
    });
    if (!authorized) {
      throw new ForbiddenException('MCP learning context rejected');
    }
    const body = exactObject(rawBody, SEARCH_KEYS);
    if (body.schemaVersion !== 1) {
      throw invalidRequest();
    }
    const query = boundedString(body.query, 500).trim();
    if (!query) {
      throw invalidRequest();
    }
    const limit = boundedInteger(body.limit, 1, 10);
    const result = await this.aiProxy.recommend(
      { query, limit, contextSnapshotId: claims.contextSnapshotId },
      claims.ownerId,
    );
    const response = objectValue(result);
    if (!Array.isArray(response.sources) || response.sources.length > limit) {
      throw new BadGatewayException(
        'MCP search dependency returned invalid data',
      );
    }
    const sources = response.sources.map(validateSource);
    return { schemaVersion: 1, query, sources };
  }

  @Post('tool-calls')
  @HttpCode(HttpStatus.OK)
  async recordToolCall(
    @Req() request: McpAuthenticatedRequest,
    @Body() rawBody: unknown,
  ) {
    const body = exactObject(rawBody, AUDIT_KEYS);
    const claims = request.mcpClaims;
    if (
      body.schemaVersion !== 1 ||
      body.runId !== claims.runId ||
      body.attemptId !== claims.attemptId
    ) {
      throw invalidRequest();
    }
    const requestId = boundedString(body.requestId, 128);
    const toolName = boundedString(body.toolName, 128);
    const source = boundedString(body.source, 256);
    const inputSchemaVersion = boundedInteger(
      body.inputSchemaVersion,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const outputSchemaVersion =
      body.outputSchemaVersion === null
        ? null
        : boundedInteger(body.outputSchemaVersion, 1, Number.MAX_SAFE_INTEGER);
    const durationMs = boundedInteger(body.durationMs, 0, 300_000);
    if (
      !TOOL_NAMES.has(toolName) ||
      source !== 'mcp-streamable-http' ||
      typeof body.outcome !== 'string' ||
      !OUTCOMES.has(body.outcome as RecordAgentToolCallCommand['outcome'])
    ) {
      throw invalidRequest();
    }
    const capability = TOOL_CAPABILITIES.get(toolName);
    if (!capability) throw invalidRequest();
    requireMcpCapability(request, capability);
    const authorized = await this.learning.authorizeAgentMcpCall({
      ownerId: claims.ownerId,
      runId: claims.runId,
      attemptId: claims.attemptId,
      leaseToken: claims.leaseToken,
      contextSnapshotId: claims.contextSnapshotId,
      capability,
    });
    if (!authorized) {
      throw new ForbiddenException('MCP learning context rejected');
    }
    const input = safeAuditSummary(body.input);
    const output = body.output === null ? null : safeAuditSummary(body.output);
    const accepted = await this.learning.recordAgentToolCall({
      ownerId: claims.ownerId,
      runId: claims.runId,
      attemptId: claims.attemptId,
      requestId,
      toolName,
      inputSchemaVersion,
      outputSchemaVersion,
      durationMs,
      outcome: body.outcome as RecordAgentToolCallCommand['outcome'],
      source,
      input,
      output,
    });
    if (!accepted) {
      throw new ForbiddenException('MCP audit identity rejected');
    }
    return { accepted: true };
  }
}

function exactObject(value: unknown, allowedKeys: ReadonlySet<string>) {
  const object = objectValue(value);
  if (Object.keys(object).some((key) => !allowedKeys.has(key))) {
    throw invalidRequest();
  }
  return object;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest();
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw invalidRequest();
  }
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw invalidRequest();
  }
  return value as number;
}

function validateSource(value: unknown): Record<string, unknown> {
  const source = objectValue(value);
  const citation = objectValue(source.citation);
  if (
    !['post', 'course_step'].includes(String(source.sourceKind)) ||
    !['private', 'public'].includes(String(source.visibility)) ||
    !['string', 'number'].includes(typeof source.sourceId) ||
    typeof source.title !== 'string' ||
    !source.title ||
    source.title.length > 500 ||
    typeof source.content !== 'string' ||
    source.content.length > 12_000 ||
    typeof source.score !== 'number' ||
    !Number.isFinite(source.score) ||
    !safeHttpsUrl(citation.sourceUrl) ||
    (citation.timestampSeconds !== null &&
      (typeof citation.timestampSeconds !== 'number' ||
        !Number.isFinite(citation.timestampSeconds) ||
        citation.timestampSeconds < 0))
  ) {
    throw new BadGatewayException(
      'MCP search dependency returned invalid data',
    );
  }
  return {
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    visibility: source.visibility,
    title: source.title,
    content: source.content,
    score: source.score,
    citation: {
      sourceUrl: citation.sourceUrl,
      timestampSeconds: citation.timestampSeconds,
    },
  };
}

function safeHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function invalidRequest(): BadRequestException {
  return new BadRequestException('Invalid MCP request');
}

const AUDIT_SUMMARY_KEYS = new Set([
  'schemaVersion',
  'contextSnapshotId',
  'requestedStepCount',
  'requestedCount',
  'resourceId',
  'resourceIds',
  'resourceCount',
  'sourceCount',
  'groundedStepCount',
  'proposalVersion',
  'version',
  'rangeStartSeconds',
  'rangeEndSeconds',
  'outcome',
]);

function safeAuditSummary(value: unknown): Record<string, unknown> {
  const record = objectValue(value);
  const summary: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (!AUDIT_SUMMARY_KEYS.has(key)) throw invalidRequest();
    if (key === 'contextSnapshotId') {
      if (typeof item !== 'string' || !UUID_PATTERN.test(item)) {
        throw invalidRequest();
      }
    } else if (key === 'resourceId') {
      if (!safeResourceId(item)) throw invalidRequest();
    } else if (key === 'resourceIds') {
      if (
        !Array.isArray(item) ||
        item.length > 20 ||
        !item.every(safeResourceId)
      ) {
        throw invalidRequest();
      }
    } else if (key === 'outcome') {
      if (typeof item !== 'string' || !OUTCOMES.has(item as never)) {
        throw invalidRequest();
      }
    } else if (!Number.isSafeInteger(item) || Number(item) < 0) {
      throw invalidRequest();
    }
    summary[key] = item;
  }
  return summary;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function safeResourceId(value: unknown): boolean {
  return (
    (Number.isSafeInteger(value) && Number(value) > 0) ||
    (typeof value === 'string' &&
      (UUID_PATTERN.test(value) || /^[A-Za-z0-9_-]{11}$/u.test(value)))
  );
}

async function verifiedProposedSteps(
  response: unknown,
  requestedStepCount: number,
  database: DatabaseService,
): Promise<ProposedCourseStep[]> {
  const result = objectValue(response);
  if (!Array.isArray(result.sources)) {
    throw new TypeError('Invalid evidence response');
  }
  const proposed: ProposedCourseStep[] = [];
  const seen = new Set<number>();
  for (const value of result.sources) {
    if (proposed.length >= requestedStepCount) break;
    const source = objectValue(value);
    if (source.sourceKind !== 'post') continue;
    const postId = boundedInteger(Number(source.sourceId), 1, 2_147_483_647);
    if (seen.has(postId)) continue;
    const citation = objectValue(source.citation);
    const evidenceSourceUrl = boundedString(citation.sourceUrl, 2048);
    const evidenceTimestampSeconds = boundedInteger(
      citation.timestampSeconds,
      0,
      86_400,
    );
    const score = Number(source.score);
    if (!Number.isFinite(score)) continue;
    const post = await database.findPost(postId);
    if (
      !post ||
      canonicalYoutubeId(post.videoUrl) !==
        canonicalYoutubeId(evidenceSourceUrl)
    ) {
      continue;
    }
    seen.add(postId);
    const asset = await database.findVideoAsset(postId);
    proposed.push({
      position: proposed.length + 1,
      title: post.title,
      videoUrl: post.videoUrl,
      thumbnailUrl: post.thumbnailUrl,
      channelName: post.channelName,
      sourcePostId: post.id,
      evidenceSourceUrl,
      evidenceTimestampSeconds,
      evidenceConfidence: Math.max(0, Math.min(1, score)),
      status: 'ready',
      durationSeconds: evidenceDuration(asset, evidenceTimestampSeconds),
    });
  }
  if (proposed.length !== requestedStepCount) {
    throw new TypeError('Insufficient verified evidence');
  }
  return proposed;
}

function safeUsage(value: unknown) {
  const row = objectValue(value);
  const usage =
    row.usage && typeof row.usage === 'object' && !Array.isArray(row.usage)
      ? (row.usage as Record<string, unknown>)
      : {};
  return {
    toolCalls: Math.max(1, safeNonNegativeInteger(usage.toolCalls, 1)),
    tokens: safeNonNegativeInteger(usage.totalTokens ?? usage.tokens, 0),
    estimatedCostUsd: safeNonNegativeNumber(
      usage.estimatedCostUsd ?? usage.costUsd,
    ),
  };
}

function safeNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function safeNonNegativeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function canonicalYoutubeId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
    ) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else {
        const [kind, candidate] = url.pathname.split('/').filter(Boolean);
        if (['embed', 'shorts', 'live'].includes(kind ?? '')) id = candidate;
      }
    }
    return id && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
  } catch {
    return null;
  }
}

function evidenceDuration(
  asset: Awaited<ReturnType<DatabaseService['findVideoAsset']>>,
  timestampSeconds: number,
): number {
  const segment = asset
    ? [...asset.translatedSegments, ...asset.sourceSegments].find(
        (candidate) =>
          Number.isFinite(candidate.start) &&
          Number.isFinite(candidate.end) &&
          candidate.start >= 0 &&
          candidate.end > candidate.start &&
          timestampSeconds >= candidate.start &&
          timestampSeconds < candidate.end,
      )
    : undefined;
  return segment ? Math.max(1, Math.ceil(segment.end - segment.start)) : 300;
}
