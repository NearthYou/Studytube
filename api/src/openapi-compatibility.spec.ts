import {
  assertBootstrapBaselineProvenance,
  findBreakingChanges,
} from './openapi-compatibility';

describe('OpenAPI compatibility', () => {
  it('detects removed operations and newly required parameters', () => {
    const baseline = {
      'x-studytube-contract-version': 1,
      paths: {
        '/posts': {
          get: { responses: { '200': {} } },
          post: { responses: { '201': {} } },
        },
      },
    };
    const current = {
      paths: {
        '/posts': {
          get: {
            parameters: [{ in: 'query', name: 'cursor', required: true }],
            responses: { '200': {} },
          },
        },
      },
    };

    expect(findBreakingChanges(baseline, current)).toEqual([
      'added required parameter query:cursor to GET /posts',
      'removed operation POST /posts',
    ]);
  });

  it('detects schema removals, type changes, enum narrowing, and newly required properties', () => {
    const baseline = {
      'x-studytube-contract-version': 1,
      paths: {},
      components: {
        schemas: {
          Course: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer' },
              status: { type: 'string', enum: ['draft', 'published'] },
              title: { type: 'string' },
              description: { type: 'string' },
            },
          },
          RemovedSchema: { type: 'object' },
        },
      },
    };
    const current = {
      paths: {},
      components: {
        schemas: {
          Course: {
            type: 'object',
            required: ['id', 'title'],
            properties: {
              id: { type: 'string' },
              status: { type: 'string', enum: ['published'] },
              title: { type: 'string' },
            },
          },
        },
      },
    };

    expect(findBreakingChanges(baseline, current)).toEqual([
      'removed schema RemovedSchema',
      'changed type of schema Course property id from integer to string',
      'removed enum value draft from schema Course property status',
      'removed schema Course property description',
      'made schema Course property title required',
    ]);
  });

  it('detects parameter and response schema changes', () => {
    const baseline = {
      'x-studytube-contract-version': 1,
      paths: {
        '/courses/{id}': {
          get: {
            parameters: [
              {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'integer' },
              },
              {
                in: 'query',
                name: 'locale',
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { title: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const current = {
      paths: {
        '/courses/{id}': {
          get: {
            parameters: [
              {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { title: { type: 'integer' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(findBreakingChanges(baseline, current)).toEqual([
      'changed type of schema parameter path:id on GET /courses/{id} from integer to string',
      'removed parameter query:locale from GET /courses/{id}',
      'changed type of schema response 200 for GET /courses/{id} application/json property title from string to integer',
    ]);
  });

  it('detects removed request and response media types and changed references', () => {
    const baseline = {
      'x-studytube-contract-version': 1,
      paths: {
        '/courses': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreateCourse' },
                },
              },
            },
            responses: {
              '201': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Course' },
                  },
                },
              },
            },
          },
        },
      },
    };
    const current = {
      paths: {
        '/courses': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/NewCourse' },
                },
              },
            },
            responses: { '201': {} },
          },
        },
      },
    };

    expect(findBreakingChanges(baseline, current)).toEqual([
      'changed schema reference request body for POST /courses application/json from #/components/schemas/CreateCourse to #/components/schemas/NewCourse',
      'removed media type application/json from response 201 for POST /courses',
    ]);
  });

  it('allows the one-time enrichment of an undocumented legacy baseline', () => {
    const baseline = {
      paths: {
        '/login': {
          post: { parameters: [], responses: { '200': {} } },
        },
      },
      components: {
        schemas: { LoginDto: { type: 'object', properties: {} } },
      },
    };
    const current = {
      'x-studytube-contract-version': 1,
      paths: {
        '/login': {
          post: {
            parameters: [{ in: 'header', name: 'x-client', required: true }],
            responses: { '200': {} },
          },
        },
      },
      components: {
        schemas: {
          LoginDto: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string' } },
          },
        },
      },
    };

    expect(findBreakingChanges(baseline, current)).toEqual([]);
  });

  it('detects operation authentication boundary changes', () => {
    const baseline = {
      'x-studytube-contract-version': 1,
      paths: {
        '/me': {
          get: { responses: { '200': {} } },
        },
        '/health': {
          get: { security: [], responses: { '200': {} } },
        },
      },
    };
    const current = {
      'x-studytube-contract-version': 1,
      paths: {
        '/me': {
          get: { security: [], responses: { '200': {} } },
        },
        '/health': {
          get: { responses: { '200': {} } },
        },
      },
    };

    expect(findBreakingChanges(baseline, current)).toEqual([
      'changed authentication requirement for GET /me',
      'changed authentication requirement for GET /health',
    ]);
  });

  it('rejects a first-adoption baseline that is not tied to the expected base source', () => {
    const expected = {
      commit: '7e544cfa1829f7b058a9c9b91e74433fe1a79405',
      apiSourceTree: '64f65a99e2a8b80fc7f3ff8a625b42e21c4c90cc',
    };

    expect(() =>
      assertBootstrapBaselineProvenance({ paths: {} }, expected),
    ).toThrow('OpenAPI bootstrap baseline provenance is missing');
    expect(() =>
      assertBootstrapBaselineProvenance(
        {
          paths: {},
          'x-studytube-baseline-source': {
            commit: expected.commit,
            apiSourceTree: 'ffffffffffffffffffffffffffffffffffffffff',
          },
        },
        expected,
      ),
    ).toThrow(
      'OpenAPI bootstrap baseline does not match base commit ' +
        '7e544cfa1829f7b058a9c9b91e74433fe1a79405',
    );
  });

  it('accepts a first-adoption baseline tied to the expected commit and API source tree', () => {
    const expected = {
      commit: '7e544cfa1829f7b058a9c9b91e74433fe1a79405',
      apiSourceTree: '64f65a99e2a8b80fc7f3ff8a625b42e21c4c90cc',
    };

    expect(() =>
      assertBootstrapBaselineProvenance(
        {
          paths: {},
          'x-studytube-baseline-source': expected,
        },
        expected,
      ),
    ).not.toThrow();
  });
});
