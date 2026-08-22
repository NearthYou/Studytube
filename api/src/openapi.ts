import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  domainOpenApiSchemas,
  domainResponseSchemas,
  type OpenApiSchema as Schema,
} from './openapi-domain-schemas';

const jsonResponseSchemas: Record<string, Schema> = {
  ...domainResponseSchemas,
  AuthController_signup: acceptedStatusSchema(),
  AuthController_resend: acceptedStatusSchema(),
  AuthController_registrationReadiness: {
    type: 'object',
    required: ['status'],
    properties: { status: { type: 'string', enum: ['ready'] } },
  },
  AuthController_completeRegistration: userEnvelopeSchema(),
  AuthController_login: userEnvelopeSchema(),
  AuthController_getMe: { $ref: '#/components/schemas/AuthPublicUser' },
  AuthController_verifyProfile: {
    $ref: '#/components/schemas/AuthPublicUser',
  },
  AuthController_updateProfile: {
    $ref: '#/components/schemas/AuthPublicUser',
  },
  AppController_getHealth: { $ref: '#/components/schemas/Liveness' },
  AppController_getLiveness: { $ref: '#/components/schemas/Liveness' },
  AppController_getReadiness: { $ref: '#/components/schemas/Readiness' },
  AppController_getAiHealth: {
    type: 'object',
    required: ['service', 'status', 'ai'],
    properties: {
      service: { type: 'string', enum: ['api'] },
      status: { type: 'string', enum: ['ok'] },
      ai: { type: 'object', additionalProperties: true },
    },
  },
  AppController_getDbHealth: {
    $ref: '#/components/schemas/DatabaseHealth',
  },
  StudyBoardController_deletePost: deletedSchema(),
  StudyBoardController_deleteComment: deletedSchema(),
  StudyBoardController_deletePlaylist: deletedSchema(),
  McpController_search: { $ref: '#/components/schemas/McpSearchResult' },
  McpController_recordToolCall: {
    type: 'object',
    required: ['accepted'],
    properties: { accepted: { type: 'boolean', enum: [true] } },
  },
  LearningItemController_start: {
    $ref: '#/components/schemas/LearningIntakeResponse',
  },
  LearningItemController_createNote: {
    $ref: '#/components/schemas/LearningNote',
  },
  LearningItemController_updateNote: {
    $ref: '#/components/schemas/LearningNote',
  },
  LearningItemController_deleteNote: deletedSchema(),
};

export function createOpenApiDocument(app: INestApplication) {
  const configuration = new DocumentBuilder()
    .setTitle('StudyTube API')
    .setDescription('Authenticated StudyTube web and learning API')
    .setVersion('1.0.0')
    .addCookieAuth(
      'studytube_session',
      { type: 'apiKey', in: 'cookie' },
      'session',
    )
    .addCookieAuth(
      'studytube_enrollment',
      { type: 'apiKey', in: 'cookie' },
      'enrollment',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'MCP service assertion' },
      'mcpService',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-internal-api-key' },
      'internalApiKey',
    )
    .addSecurityRequirements('session')
    .build();
  const document = SwaggerModule.createDocument(app, configuration, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey}_${methodKey}`,
  });
  Object.assign(document, { 'x-studytube-contract-version': 1 });
  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ...domainOpenApiSchemas,
    AuthPublicUser: {
      type: 'object',
      required: ['id', 'name', 'email', 'createdAt'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        preferences: { $ref: '#/components/schemas/LearningPreferences' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    LearningPreferences: {
      type: 'object',
      required: ['interests', 'pace', 'goal'],
      properties: {
        interests: {
          type: 'array',
          maxItems: 8,
          items: { type: 'string', maxLength: 100 },
        },
        pace: { type: 'string', maxLength: 100 },
        goal: { type: 'string', maxLength: 500 },
      },
    },
    DatabaseHealth: {
      type: 'object',
      required: ['service', 'status', 'ready', 'database', 'timestamp'],
      properties: {
        service: { type: 'string', enum: ['api'] },
        status: { type: 'string', enum: ['ok', 'unknown', 'unavailable'] },
        ready: { type: 'boolean' },
        database: { type: 'string', enum: ['postgresql + pgvector'] },
        error: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
    Liveness: {
      type: 'object',
      required: ['service', 'status', 'live', 'timestamp'],
      properties: {
        service: { type: 'string', enum: ['api'] },
        status: { type: 'string', enum: ['ok'] },
        live: { type: 'boolean', enum: [true] },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
    Readiness: {
      type: 'object',
      required: ['service', 'status', 'ready', 'dependencies', 'timestamp'],
      properties: {
        service: { type: 'string', enum: ['api'] },
        status: { type: 'string', enum: ['ok', 'unavailable'] },
        ready: { type: 'boolean' },
        dependencies: {
          type: 'object',
          required: ['database'],
          properties: {
            database: { $ref: '#/components/schemas/DatabaseHealth' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
    McpSearchResult: {
      type: 'object',
      required: ['schemaVersion', 'query', 'sources'],
      properties: {
        schemaVersion: { type: 'integer', enum: [1] },
        query: { type: 'string' },
        sources: {
          type: 'array',
          items: { $ref: '#/components/schemas/RetrievalSourceResponse' },
        },
      },
    },
    LearningIntakeResponse: {
      type: 'object',
      required: [
        'reservationId',
        'workId',
        'admission',
        'reservedAudioSeconds',
        'context',
      ],
      properties: {
        reservationId: { type: 'string', pattern: '^[1-9]\\d*$' },
        workId: { type: 'string', format: 'uuid' },
        admission: { type: 'string', enum: ['created', 'joined'] },
        reservedAudioSeconds: { type: 'integer', minimum: 1, maximum: 14400 },
        context: { type: 'object', additionalProperties: true },
      },
    },
    LearningNote: {
      type: 'object',
      required: [
        'id',
        'userId',
        'studyContextId',
        'positionSeconds',
        'body',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { type: 'string', pattern: '^[1-9]\\d*$' },
        userId: { type: 'integer', minimum: 1 },
        studyContextId: { type: 'string', pattern: '^[1-9]\\d*$' },
        positionSeconds: { type: 'number', minimum: 0 },
        body: { type: 'string', minLength: 1, maxLength: 4000 },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  };
  applyExplicitResponseSchemas(document);
  for (const pathValue of Object.values(document.paths) as unknown[]) {
    if (!isRecord(pathValue)) {
      continue;
    }
    for (const operationValue of Object.values(pathValue)) {
      if (
        isRecord(operationValue) &&
        operationValue['x-studytube-public'] === true
      ) {
        operationValue.security = publicOperationSecurity(
          operationValue.operationId,
        );
        delete operationValue['x-studytube-public'];
      }
    }
  }
  return document;
}

function applyExplicitResponseSchemas(document: {
  paths: Record<string, unknown>;
}): void {
  for (const pathItem of Object.values(document.paths)) {
    if (typeof pathItem !== 'object' || pathItem === null) {
      continue;
    }
    for (const operationValue of Object.values(pathItem)) {
      if (typeof operationValue !== 'object' || operationValue === null) {
        continue;
      }
      const operation = operationValue as {
        operationId?: string;
        responses?: Record<
          string,
          { content?: Record<string, { schema?: Schema }> }
        >;
      };
      if (!operation.operationId || !operation.responses) {
        continue;
      }
      const jsonSchema = jsonResponseSchemas[operation.operationId];
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!/^2\d\d$/u.test(status) || status === '204') {
          continue;
        }
        if (operation.operationId === 'InternalMetricsController_metrics') {
          response.content = {
            'text/plain': { schema: { type: 'string' } },
          };
        } else if (jsonSchema) {
          response.content = {
            'application/json': { schema: jsonSchema },
          };
        }
      }
    }
  }
}

function acceptedStatusSchema(): Schema {
  return {
    type: 'object',
    required: ['status'],
    properties: { status: { type: 'string', enum: ['accepted'] } },
  };
}

function userEnvelopeSchema(): Schema {
  return {
    type: 'object',
    required: ['user'],
    properties: {
      user: { $ref: '#/components/schemas/AuthPublicUser' },
    },
  };
}

function deletedSchema(): Schema {
  return {
    type: 'object',
    required: ['deleted'],
    properties: { deleted: { type: 'boolean' } },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function publicOperationSecurity(operationId: unknown): Schema[] {
  if (
    operationId === 'AuthController_registrationReadiness' ||
    operationId === 'AuthController_completeRegistration'
  ) {
    return [{ enrollment: [] }];
  }
  if (
    typeof operationId === 'string' &&
    operationId.startsWith('McpController_')
  ) {
    return [{ mcpService: [] }];
  }
  if (operationId === 'InternalMetricsController_metrics') {
    return [{ internalApiKey: [] }];
  }
  return [];
}
