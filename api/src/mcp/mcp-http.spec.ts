import { createHmac, randomUUID } from 'node:crypto';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AiProxyService } from '../ai-proxy.service';
import { DatabaseService } from '../database.service';
import { LearningService } from '../learning/learning.service';
import { McpController } from './mcp.controller';
import { McpServiceAssertionGuard } from './mcp-service-assertion.guard';
import { McpServiceAssertionVerifier } from './mcp-service-assertion';

const SECRET = 'mcp-test-secret-that-is-at-least-thirty-two-bytes';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

describe('MCP internal HTTP boundary', () => {
  let app: INestApplication;
  const auditCalls: Array<Record<string, unknown>> = [];
  const recommendCalls: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        McpServiceAssertionVerifier,
        McpServiceAssertionGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({ MCP_SERVICE_ASSERTION_SECRET: SECRET }),
        },
        {
          provide: AiProxyService,
          useValue: {
            recommend: (body: unknown, ownerId: number) => {
              const input = body as Record<string, unknown>;
              recommendCalls.push(input);
              if (
                input.contextSnapshotId &&
                input.query === 'bounded objective'
              ) {
                return Promise.resolve({
                  sources: [
                    {
                      sourceKind: 'learning_context',
                      sourceId: input.contextSnapshotId,
                      visibility: 'private',
                      score: 0.95,
                      citation: {
                        sourceUrl:
                          'https://www.youtube.com/watch?v=context0001',
                        timestampSeconds: 3,
                      },
                    },
                  ],
                });
              }
              const ids = input.query === 'bounded objective' ? [7, 8, 9] : [7];
              return Promise.resolve({
                mode: 'hybrid',
                query: input.query,
                sources: ids.map((id) => ({
                  sourceKind: 'post',
                  sourceId: String(id),
                  visibility: 'private',
                  title: `owner-${ownerId}`,
                  content: 'Grounded source',
                  score: 0.9,
                  citation: {
                    sourceUrl: `https://www.youtube.com/watch?v=video00000${id}`,
                    timestampSeconds: 12,
                  },
                })),
              });
            },
          },
        },
        {
          provide: LearningService,
          useValue: {
            authorizeAgentMcpCall: () => Promise.resolve(true),
            recordAgentToolCall: (command: Record<string, unknown>) => {
              auditCalls.push(command);
              return Promise.resolve(true);
            },
          },
        },
        {
          provide: DatabaseService,
          useValue: {
            findPost: (id: number) =>
              Promise.resolve(
                [7, 8, 9].includes(id)
                  ? {
                      id,
                      title: `추천 영상 ${id}`,
                      videoUrl: `https://www.youtube.com/watch?v=video00000${id}`,
                      thumbnailUrl: '',
                      channelName: 'StudyTube',
                    }
                  : null,
              ),
            findVideoAsset: () => Promise.resolve(null),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    auditCalls.splice(0);
    recommendCalls.splice(0);
  });

  it('uses only the signed subject as the search owner', async () => {
    const response = await request()
      .post('/internal/mcp/search')
      .set('Authorization', `Bearer ${mintAssertion()}`)
      .send({ schemaVersion: 1, query: 'state machines', limit: 3 })
      .expect(HttpStatus.OK);

    expect(response.body).toEqual({
      schemaVersion: 1,
      query: 'state machines',
      sources: [
        expect.objectContaining({
          sourceId: '7',
          title: 'owner-42',
        }),
      ],
    });
  });

  it('uses private context evidence without crowding out public proposal candidates', async () => {
    const response = await request()
      .post('/internal/mcp/learning/plan')
      .set('Authorization', `Bearer ${mintAssertion()}`)
      .send({
        schemaVersion: 1,
        objective: 'bounded objective',
        requestedStepCount: 3,
      })
      .expect(HttpStatus.OK);

    expect(response.body).toMatchObject({
      schemaVersion: 1,
      evidenceCount: 1,
      usage: { toolCalls: 2 },
      proposedSteps: [
        { sourcePostId: 7 },
        { sourcePostId: 8 },
        { sourcePostId: 9 },
      ],
    });
    expect(recommendCalls).toHaveLength(2);
    expect(recommendCalls[0]).toMatchObject({ contextSnapshotId: RUN_ID });
    expect(recommendCalls[1]).not.toHaveProperty('contextSnapshotId');
  });

  it('rejects request-body owner injection', async () => {
    await request()
      .post('/internal/mcp/search')
      .set('Authorization', `Bearer ${mintAssertion()}`)
      .send({
        schemaVersion: 1,
        query: 'state machines',
        limit: 3,
        ownerId: 999,
      })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('does not accept a browser session cookie without a service assertion', async () => {
    await request()
      .post('/internal/mcp/search')
      .set('Cookie', 'studytube_session=browser-session')
      .send({ schemaVersion: 1, query: 'state machines', limit: 3 })
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('rejects a Course proposal when the assertion has search-only capability', async () => {
    await request()
      .post('/internal/mcp/learning/plan')
      .set(
        'Authorization',
        `Bearer ${mintAssertion(['learning:evidence:search'])}`,
      )
      .send({
        schemaVersion: 1,
        objective: 'bounded objective',
        requestedStepCount: 3,
      })
      .expect(HttpStatus.FORBIDDEN);

    expect(auditCalls).toHaveLength(0);
  });

  it('binds audit identity to the assertion instead of request data', async () => {
    await request()
      .post('/internal/mcp/tool-calls')
      .set('Authorization', `Bearer ${mintAssertion()}`)
      .send({
        schemaVersion: 1,
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        requestId: 'tool-call-17',
        toolName: 'search_studytube',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
        durationMs: 23,
        outcome: 'succeeded',
        source: 'mcp-streamable-http',
        input: { requestedCount: 3 },
        output: { schemaVersion: 1, sourceCount: 1, outcome: 'succeeded' },
      })
      .expect(HttpStatus.OK, { accepted: true });

    expect(auditCalls).toEqual([
      expect.objectContaining({
        ownerId: 42,
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        requestId: 'tool-call-17',
      }),
    ]);
  });

  it('rejects an audit event whose run identity differs from its assertion', async () => {
    await request()
      .post('/internal/mcp/tool-calls')
      .set('Authorization', `Bearer ${mintAssertion()}`)
      .send({
        schemaVersion: 1,
        runId: '33333333-3333-4333-8333-333333333333',
        attemptId: ATTEMPT_ID,
        requestId: 'tool-call-18',
        toolName: 'search_studytube',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
        durationMs: 23,
        outcome: 'succeeded',
        source: 'mcp-streamable-http',
        input: { requestedCount: 3 },
        output: { schemaVersion: 1, sourceCount: 1 },
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(auditCalls).toHaveLength(0);
  });

  it('rejects private text and URL canaries from the audit summary', async () => {
    await request()
      .post('/internal/mcp/tool-calls')
      .set('Authorization', `Bearer ${mintAssertion()}`)
      .send({
        schemaVersion: 1,
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        requestId: 'tool-call-canary',
        toolName: 'search_learning_evidence',
        inputSchemaVersion: 1,
        outputSchemaVersion: null,
        durationMs: 1,
        outcome: 'failed',
        source: 'mcp-streamable-http',
        input: { query: 'private-note-canary' },
        output: { sourceUrl: 'https://private.example/token=canary' },
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(auditCalls).toHaveLength(0);
  });

  function request() {
    return supertest(app.getHttpServer() as Parameters<typeof supertest>[0]);
  }
});

function mintAssertion(
  capabilities = [
    'learning:evidence:search',
    'learning:metadata:verify',
    'learning:proposal:create',
  ],
): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'studytube-mcp',
    aud: 'studytube-api',
    sub: '42',
    iat: issuedAt,
    exp: issuedAt + 60,
    jti: randomUUID(),
    scope: 'studytube:internal:mcp',
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    lease_token: '33333333-3333-4333-8333-333333333333',
    context_snapshot_id: RUN_ID,
    capabilities,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', SECRET)
    .update(signingInput, 'ascii')
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

function encode(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
