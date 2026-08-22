import type { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import type { ClaimAgentRun } from '../learning/learning.repository';
import { LoopbackMcpLearningClient } from './mcp-learning.client';

const SECRET = 'mcp-test-secret-that-is-at-least-thirty-two-bytes';

describe('LoopbackMcpLearningClient', () => {
  it('uses an authenticated MCP session and calls only the proposal tool', async () => {
    const post = jest
      .fn()
      .mockImplementationOnce((_url, body: { id: string }) =>
        of({
          data: {
            jsonrpc: '2.0',
            id: body.id,
            result: { protocolVersion: '2026-07-28' },
          },
          headers: { 'mcp-session-id': 'session-1' },
        }),
      )
      .mockImplementationOnce(() => of({ data: null, headers: {} }))
      .mockImplementationOnce((_url, body: { id: string }) =>
        of({
          data: {
            jsonrpc: '2.0',
            id: body.id,
            result: { structuredContent: groundedPlan() },
          },
          headers: {},
        }),
      );
    const client = new LoopbackMcpLearningClient(
      { post } as unknown as HttpService,
      new ConfigService({
        AI_SERVICE_URL: 'http://127.0.0.1:8000',
        MCP_SERVICE_ASSERTION_SECRET: SECRET,
      }),
    );

    await expect(
      client.buildGroundedPlan(claim(), {
        objective: 'state machines',
        requestedStepCount: 3,
      }),
    ).resolves.toEqual(groundedPlan());

    expect(post).toHaveBeenCalledTimes(3);
    type PostCall = [
      string,
      Record<string, unknown>,
      { headers: Record<string, string>; timeout: number },
    ];
    const [initializeUrl, initializeBody, initializeOptions] = post.mock
      .calls[0] as unknown as PostCall;
    expect(initializeUrl).toBe('http://127.0.0.1:8000/mcp');
    expect(initializeBody).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2026-07-28' },
    });
    expect(initializeOptions.headers.Accept).toBe(
      'application/json, text/event-stream',
    );
    const authorization = initializeOptions.headers.Authorization;
    const claims = JSON.parse(
      Buffer.from(authorization.split('.')[1] ?? '', 'base64url').toString(
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: 'https://api.studytube.internal',
      aud: 'studytube-mcp',
      scope: 'studytube:mcp:invoke',
      run_id: claim().run.id,
      attempt_id: claim().attemptId,
      lease_token: claim().leaseToken,
      context_snapshot_id: claim().run.id,
      capabilities: [
        'learning:evidence:search',
        'learning:metadata:verify',
        'learning:proposal:create',
      ],
    });
    const initializedCall = post.mock.calls[1] as unknown as PostCall;
    const toolCall = post.mock.calls[2] as unknown as PostCall;
    expect(initializedCall[1]).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(toolCall[1]).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'propose_next_learning',
        arguments: {
          objective: 'state machines',
          requested_step_count: 3,
        },
      },
    });
    expect(toolCall[2].headers['Mcp-Session-Id']).toBe('session-1');
    expect(JSON.stringify(post.mock.calls)).not.toContain(
      '/internal/mcp/learning/plan',
    );
  });

  it('rejects a non-internal AI service URL before making a request', () => {
    expect(
      () =>
        new LoopbackMcpLearningClient(
          { post: jest.fn() } as unknown as HttpService,
          new ConfigService({
            AI_SERVICE_URL: 'https://public.example/mcp',
            MCP_SERVICE_ASSERTION_SECRET: SECRET,
          }),
        ),
    ).toThrow(/internal AI/u);
  });
});

function claim(): ClaimAgentRun {
  return {
    run: {
      id: '11111111-1111-4111-8111-111111111111',
      ownerId: 42,
      courseId: null,
      state: 'running',
      version: 2,
      input: {},
      budgets: {
        wallTimeBudgetMs: 60_000,
        toolCallBudget: 8,
        tokenBudget: 10_000,
        estimatedCostBudgetUsd: 0.2,
      },
      usage: { toolCalls: 0, tokens: 0, estimatedCostUsd: 0 },
      queuedAt: '2026-08-22T00:00:00.000Z',
      startedAt: '2026-08-22T00:00:01.000Z',
      finishedAt: null,
      updatedAt: '2026-08-22T00:00:01.000Z',
      cancellationRequestedAt: null,
      failureCode: null,
      attempts: [],
      transitions: [],
      proposedSteps: [],
    },
    attemptId: '22222222-2222-4222-8222-222222222222',
    attemptNumber: 1,
    leaseToken: '33333333-3333-4333-8333-333333333333',
  };
}

function groundedPlan() {
  return {
    schemaVersion: 1 as const,
    proposedSteps: [1, 2, 3].map((position) => ({
      position,
      title: `Lesson ${position}`,
      videoUrl: `https://www.youtube.com/watch?v=source0000${position}`,
      thumbnailUrl: `https://i.ytimg.com/vi/source0000${position}/hqdefault.jpg`,
      channelName: 'Channel',
      sourcePostId: position,
      evidenceSourceUrl: `https://www.youtube.com/watch?v=source0000${position}`,
      evidenceTimestampSeconds: position * 10,
      evidenceConfidence: 0.9,
      status: 'ready' as const,
      durationSeconds: 30,
    })),
    usage: { toolCalls: 1, tokens: 100, estimatedCostUsd: 0.01 },
    evidenceCount: 3,
    proposalVersion: 1,
  };
}
