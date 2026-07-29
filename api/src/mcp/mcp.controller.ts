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
import { Public } from '../auth/public.decorator';
import { LearningService } from '../learning/learning.service';
import type { RecordAgentToolCallCommand } from '../learning/learning.repository';
import { redactTelemetryValue } from '../observability';
import {
  McpServiceAssertionGuard,
  type McpAuthenticatedRequest,
} from './mcp-service-assertion.guard';

const SEARCH_KEYS = new Set(['schemaVersion', 'query', 'limit']);
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
const TOOL_NAMES = new Set(['search_studytube', 'fetch_youtube_metadata']);

@Public()
@UseGuards(McpServiceAssertionGuard)
@Controller('internal/mcp')
export class McpController {
  constructor(
    private readonly aiProxy: AiProxyService,
    private readonly learning: LearningService,
  ) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  async search(
    @Req() request: McpAuthenticatedRequest,
    @Body() rawBody: unknown,
  ) {
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
      { query, limit },
      request.mcpClaims.ownerId,
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
    const input = redactedRecord(body.input);
    const output = body.output === null ? null : redactedRecord(body.output);
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

function redactedRecord(value: unknown): Record<string, unknown> {
  const record = objectValue(value);
  const redacted = redactTelemetryValue(record);
  if (!redacted || typeof redacted !== 'object' || Array.isArray(redacted)) {
    throw invalidRequest();
  }
  return redacted as Record<string, unknown>;
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
