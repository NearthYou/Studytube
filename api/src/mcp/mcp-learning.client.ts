import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import type { ClaimAgentRun } from '../learning/learning.repository';
import type {
  AgentUsage,
  ProposedCourseStep,
} from '../learning/learning.types';
import type { McpLearningCapability } from './mcp-service-assertion';

export type McpGroundedPlan = {
  schemaVersion: 1;
  proposedSteps: ProposedCourseStep[];
  usage: AgentUsage;
  evidenceCount: number;
  proposalVersion: number;
};

export interface McpLearningClient {
  buildGroundedPlan(
    claim: ClaimAgentRun,
    input: { objective: string; requestedStepCount: number },
  ): Promise<McpGroundedPlan>;
}

export class LoopbackMcpLearningClient implements McpLearningClient {
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = normalizeInternalBaseUrl(
      config.get<string>('AI_SERVICE_URL') ?? 'http://127.0.0.1:8000',
    );
    this.secret =
      config.get<string>('MCP_SERVICE_ASSERTION_SECRET')?.trim() ?? '';
  }

  async buildGroundedPlan(
    claim: ClaimAgentRun,
    input: { objective: string; requestedStepCount: number },
  ): Promise<McpGroundedPlan> {
    if (Buffer.byteLength(this.secret, 'utf8') < 32) {
      throw new RangeError('MCP service assertion signing is unavailable');
    }
    const capabilities: McpLearningCapability[] = [
      'learning:evidence:search',
      'learning:metadata:verify',
      'learning:proposal:create',
    ];
    const assertion = mintAssertion(this.secret, claim, capabilities);
    const endpoint = `${this.baseUrl}/mcp`;
    const commonHeaders = {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${assertion}`,
      'Content-Type': 'application/json',
    };
    const initializeId = randomUUID();
    const initialized = await firstValueFrom(
      this.http.post<unknown>(
        endpoint,
        {
          jsonrpc: '2.0',
          id: initializeId,
          method: 'initialize',
          params: {
            protocolVersion: '2026-07-28',
            capabilities: {},
            clientInfo: { name: 'studytube-agent-worker', version: '1.0.0' },
          },
        },
        { headers: commonHeaders, timeout: 60_000 },
      ),
    );
    assertMcpSuccess(initialized.data, initializeId);
    const sessionId = readSessionId(initialized.headers);
    const sessionHeaders = {
      ...commonHeaders,
      'Mcp-Session-Id': sessionId,
    };
    await firstValueFrom(
      this.http.post<unknown>(
        endpoint,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { headers: sessionHeaders, timeout: 60_000 },
      ),
    );
    const callId = randomUUID();
    const called = await firstValueFrom(
      this.http.post<unknown>(
        endpoint,
        {
          jsonrpc: '2.0',
          id: callId,
          method: 'tools/call',
          params: {
            name: 'propose_next_learning',
            arguments: {
              objective: input.objective,
              requested_step_count: input.requestedStepCount,
            },
          },
        },
        { headers: sessionHeaders, timeout: 60_000 },
      ),
    );
    const result = assertMcpSuccess(called.data, callId);
    const structured = objectValue(result.structuredContent);
    return validateGroundedPlan(structured, input.requestedStepCount);
  }
}

function mintAssertion(
  secret: string,
  claim: ClaimAgentRun,
  capabilities: readonly McpLearningCapability[],
): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'https://api.studytube.internal',
    aud: 'studytube-mcp',
    sub: String(claim.run.ownerId),
    iat: issuedAt,
    nbf: issuedAt,
    exp: issuedAt + 60,
    scope: 'studytube:mcp:invoke',
    run_id: claim.run.id,
    attempt_id: claim.attemptId,
    lease_token: claim.leaseToken,
    context_snapshot_id: claim.run.id,
    capabilities,
    jti: randomUUID(),
  });
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`, 'ascii')
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function readSessionId(value: unknown): string {
  if (!value || typeof value !== 'object') {
    throw new TypeError('MCP session header is missing');
  }
  const headers = value as {
    get?: (name: string) => unknown;
    [key: string]: unknown;
  };
  const candidate =
    headers.get?.('mcp-session-id') ??
    headers['mcp-session-id'] ??
    headers['Mcp-Session-Id'];
  if (
    typeof candidate !== 'string' ||
    !candidate ||
    candidate.length > 256 ||
    !/^[A-Za-z0-9._~-]+$/u.test(candidate)
  ) {
    throw new TypeError('MCP session header is invalid');
  }
  return candidate;
}

function assertMcpSuccess(
  value: unknown,
  expectedId: string,
): Record<string, unknown> {
  const envelope = objectValue(parseMcpPayload(value));
  if (
    envelope.jsonrpc !== '2.0' ||
    envelope.id !== expectedId ||
    envelope.error !== undefined
  ) {
    throw new TypeError('MCP response is invalid');
  }
  return objectValue(envelope.result);
}

function parseMcpPayload(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const dataLines = value
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (dataLines.length !== 1) throw new TypeError('MCP response is invalid');
  return JSON.parse(dataLines[0]) as unknown;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('MCP response is invalid');
  }
  return value as Record<string, unknown>;
}

function normalizeInternalBaseUrl(value: string): string {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase();
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    ![
      '127.0.0.1',
      'localhost',
      '::1',
      'ai',
      'studytube-ai',
      'studytube-ai.internal',
    ].includes(host)
  ) {
    throw new RangeError('MCP AI base URL must target the internal AI service');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
  return parsed.toString().replace(/\/$/u, '');
}

function validateGroundedPlan(
  value: unknown,
  requestedStepCount: number,
): McpGroundedPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('MCP plan response is invalid');
  }
  const row = value as Partial<McpGroundedPlan>;
  if (
    row.schemaVersion !== 1 ||
    !Array.isArray(row.proposedSteps) ||
    row.proposedSteps.length !== requestedStepCount ||
    !row.usage ||
    !Number.isSafeInteger(row.evidenceCount) ||
    Number(row.evidenceCount) < requestedStepCount ||
    !Number.isSafeInteger(row.proposalVersion) ||
    Number(row.proposalVersion) < 1
  ) {
    throw new TypeError('MCP plan response is invalid');
  }
  return row as McpGroundedPlan;
}
