import { createHmac, randomUUID } from 'node:crypto';
import { HttpStatus, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AiProxyService } from '../ai-proxy.service';
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
            recommend: (body: unknown, ownerId: number) =>
              Promise.resolve({
                mode: 'hybrid',
                query: (body as { query: string }).query,
                sources: [
                  {
                    sourceKind: 'post',
                    sourceId: '7',
                    visibility: 'private',
                    title: `owner-${ownerId}`,
                    content: 'Grounded source',
                    score: 0.9,
                    citation: {
                      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                      timestampSeconds: 12,
                    },
                  },
                ],
              }),
          },
        },
        {
          provide: LearningService,
          useValue: {
            recordAgentToolCall: (command: Record<string, unknown>) => {
              auditCalls.push(command);
              return Promise.resolve(true);
            },
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

  beforeEach(() => auditCalls.splice(0));

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
        input: { query: 'state machines', limit: 3 },
        output: { schemaVersion: 1, sourceCount: 1 },
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
        input: { query: 'state machines', limit: 3 },
        output: { schemaVersion: 1, sourceCount: 1 },
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(auditCalls).toHaveLength(0);
  });

  function request() {
    return supertest(app.getHttpServer() as Parameters<typeof supertest>[0]);
  }
});

function mintAssertion(): string {
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
