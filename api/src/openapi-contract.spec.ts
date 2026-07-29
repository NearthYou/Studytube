import { assertOpenApiContract } from './openapi-contract';

describe('OpenAPI contract completeness', () => {
  it('rejects empty DTOs, missing session security, and undocumented success bodies', () => {
    expect(() =>
      assertOpenApiContract({
        components: {
          schemas: { LoginDto: { type: 'object', properties: {} } },
        },
        paths: {
          '/auth/login': {
            post: { responses: { '200': {} } },
          },
        },
      }),
    ).toThrow(
      'OpenAPI contract is incomplete:\n' +
        'contract version 1 marker is missing\n' +
        'global session cookie security requirement is missing\n' +
        'schema LoginDto has no documented properties\n' +
        'POST /auth/login response 200 has no schema',
    );
  });

  it('accepts documented DTOs, cookie security, JSON responses, and 204 responses', () => {
    expect(() =>
      assertOpenApiContract({
        'x-studytube-contract-version': 1,
        security: [{ session: [] }],
        components: {
          schemas: {
            LoginDto: {
              type: 'object',
              properties: { email: { type: 'string' } },
            },
          },
        },
        paths: {
          '/auth/login': {
            post: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          user: {
                            type: 'object',
                            properties: { id: { type: 'integer' } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '/auth/logout': {
            post: { responses: { '204': {} } },
          },
        },
      }),
    ).not.toThrow();
  });

  it('rejects bare object response schemas that cannot detect field removal', () => {
    expect(() =>
      assertOpenApiContract({
        'x-studytube-contract-version': 1,
        security: [{ session: [] }],
        paths: {
          '/courses': {
            get: {
              responses: {
                '200': {
                  content: {
                    'application/json': { schema: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      }),
    ).toThrow('GET /courses response 200 has no schema');
  });

  it('rejects arrays with undocumented object items', () => {
    expect(() =>
      assertOpenApiContract({
        'x-studytube-contract-version': 1,
        security: [{ session: [] }],
        paths: {
          '/playlists': {
            get: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ).toThrow('GET /playlists response 200 has no schema');
  });

  it('rejects missing or empty referenced response components', () => {
    expect(() =>
      assertOpenApiContract({
        'x-studytube-contract-version': 1,
        security: [{ session: [] }],
        paths: {
          '/courses': {
            get: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/MissingCoursePage',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ).toThrow('GET /courses response 200 has no schema');
  });

  it('rejects incomplete Idempotency-Key contracts on learning mutations', () => {
    expect(() =>
      assertOpenApiContract({
        'x-studytube-contract-version': 1,
        security: [{ session: [] }],
        paths: {
          '/learning/agent-runs': {
            post: {
              operationId: 'LearningController_createRun',
              parameters: [],
              responses: { '204': {} },
            },
          },
          '/learning/course-steps/{stepId}/progress': {
            post: {
              operationId: 'LearningController_recordProgress',
              parameters: [
                {
                  in: 'header',
                  name: 'Idempotency-Key',
                  required: false,
                  schema: { type: 'string', maxLength: 200 },
                },
              ],
              responses: { '204': {} },
            },
          },
          '/learning/quizzes/{quizId}/attempts': {
            post: {
              operationId: 'LearningController_submitQuiz',
              parameters: [
                {
                  in: 'header',
                  name: 'Idempotency-Key',
                  required: true,
                  schema: { type: 'string', maxLength: 201 },
                },
              ],
              responses: { '204': {} },
            },
          },
        },
      }),
    ).toThrow(
      'OpenAPI contract is incomplete:\n' +
        'POST /learning/agent-runs Idempotency-Key header must be required with maxLength 200\n' +
        'POST /learning/course-steps/{stepId}/progress Idempotency-Key header must be required with maxLength 200\n' +
        'POST /learning/quizzes/{quizId}/attempts Idempotency-Key header must be required with maxLength 200',
    );
  });

  it('accepts the required Idempotency-Key contract on learning mutations', () => {
    const idempotencyHeader = {
      in: 'header',
      name: 'Idempotency-Key',
      required: true,
      schema: { type: 'string', maxLength: 200 },
    };

    expect(() =>
      assertOpenApiContract({
        'x-studytube-contract-version': 1,
        security: [{ session: [] }],
        paths: {
          '/learning/agent-runs': {
            post: {
              operationId: 'LearningController_createRun',
              parameters: [idempotencyHeader],
              responses: { '204': {} },
            },
          },
          '/learning/course-steps/{stepId}/progress': {
            post: {
              operationId: 'LearningController_recordProgress',
              parameters: [idempotencyHeader],
              responses: { '204': {} },
            },
          },
          '/learning/quizzes/{quizId}/attempts': {
            post: {
              operationId: 'LearningController_submitQuiz',
              parameters: [idempotencyHeader],
              responses: { '204': {} },
            },
          },
        },
      }),
    ).not.toThrow();
  });
});
